import { ImageParser, ImageType, matchMagic, ImageSize } from '@/napcat-image-size/src';
import { ReadStream } from 'fs';

// JPEG解析器
export class JpegParser implements ImageParser {
  readonly type = ImageType.JPEG;
  // JPEG 魔术头：FF D8
  private readonly JPEG_SIGNATURE = [0xFF, 0xD8];

  // 非SOF标记
  private readonly NON_SOF_MARKERS: number[] = [
    0xC4, // DHT
    0xC8, // JPEG扩展
    0xCC, // DAC
  ] as const;

  canParse (buffer: Buffer): boolean {
    return matchMagic(buffer, this.JPEG_SIGNATURE);
  }

  // SOF0-15 都是 0xC0-0xCF，排除 DHT/JPG/DAC。
  // 只认 SOF0-3 会导致 SOF5/9/13 等渐进/无损 JPEG 解析失败，
  // 并在段 payload 里裸扫到伪 FF C0（如 EXIF 缩略图的尺寸）
  isSOFMarker (marker: number): boolean {
    return (marker & 0xF0) === 0xC0 && !this.isNonSOFMarker(marker);
  }

  isNonSOFMarker (marker: number): boolean {
    return this.NON_SOF_MARKERS.includes(marker);
  }

  async parseSize (stream: ReadStream): Promise<ImageSize | undefined> {
    return new Promise<ImageSize | undefined>((resolve, reject) => {
      const BUFFER_SIZE = 1024; // 读取块大小，可以根据需要调整
      let buffer = Buffer.alloc(0);
      let offset = 0;
      let found = false;
      // 正在跨越数据块跳过的段 payload 剩余字节数
      let segmentRemaining = 0;

      // 处理错误
      stream.on('error', (err) => {
        stream.destroy();
        reject(err);
      });

      // 处理数据块
      stream.on('data', (chunk: Buffer | string) => {
        if (found) return;
        // 追加新数据到缓冲区
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        buffer = Buffer.concat([buffer.subarray(offset), chunkBuffer]);
        offset = 0;
        const bufferSize = buffer.length;

        // 先消耗上一次未跳完的段 payload
        if (segmentRemaining > 0) {
          if (bufferSize <= segmentRemaining) {
            // 整个块都在段内，全部丢弃
            segmentRemaining -= bufferSize;
            buffer = Buffer.alloc(0);
            offset = 0;
            return;
          }
          offset = segmentRemaining;
          segmentRemaining = 0;
        }

        // JPEG 段结构: FF marker [length(2B) payload]
        while (offset + 1 < bufferSize) {
          if (buffer[offset] !== 0xFF) {
            offset++;
            continue;
          }
          const marker = buffer[offset + 1];
          if (marker === undefined) break;
          // FF 00 为填充字节，FF FF 为连续填充
          if (marker === 0x00 || marker === 0xFF) {
            offset += 2;
            continue;
          }
          // 独立标记（无长度字段）：TEM(0x01)、RST0-7(0xD0-0xD7)、SOI(0xD8)、EOI(0xD9)
          if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
            offset += 2;
            continue;
          }
          // SOS 之后是熵编码数据，其中任意 FF XX 都是合法的扫描内容；
          // 尺寸信息一定在 SOS 之前，到 SOS 即停止，避免误匹配
          if (marker === 0xDA) {
            break;
          }
          // 需要更多数据才能读取段长度
          if (offset + 4 > bufferSize) {
            break;
          }
          const segmentLength = buffer.readUInt16BE(offset + 2);

          // 处理SOF标记 (包含尺寸信息)
          if (this.isSOFMarker(marker)) {
            // 确保缓冲区中有足够数据读取尺寸
            if (offset + 9 > bufferSize) {
              // 如果缓冲区内数据不够，保留当前位置等待更多数据
              break;
            }
            // 解析尺寸: FF XX YY YY PP HH HH WW WW ...
            // XX = 标记, YY YY = 段长度, PP = 精度, HH HH = 高, WW WW = 宽
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);

            found = true;
            stream.destroy();
            resolve({ width, height });
            return;
          }

          // 非SOF带长度标记（APPn/DHT/DQT等）：按段长跳过整个段，
          // 避免扫进段 payload 找到伪 FF XX（EXIF 缩略图、DHT 内容等）
          if (segmentLength < 2) {
            // 非法段长，无法信任，仅前进越过标记避免死循环
            offset += 2;
            continue;
          }
          const segmentEnd = offset + 2 + segmentLength;
          if (segmentEnd > bufferSize) {
            // 段跨块：记录剩余 payload 字节，丢弃本块内容等待后续数据
            segmentRemaining = segmentEnd - bufferSize;
            buffer = Buffer.alloc(0);
            offset = 0;
            return;
          }
          offset = segmentEnd;
        }

        // 缓冲区管理: 只保留未处理完的尾部用于跨块边界，丢弃之前的数据
        if (offset > BUFFER_SIZE) {
          const KEEP_BYTES = 20; // 保留足够数据以处理跨块边界的情况
          buffer = buffer.subarray(offset - KEEP_BYTES);
          offset = KEEP_BYTES;
        }
      });

      // 处理流结束
      stream.on('end', () => {
        if (!found) {
          resolve(undefined);
        }
      });
    });
  }
}
