import crypto from 'node:crypto';
import http from 'node:http';
import { NapProtoMsg } from 'napcat-protobuf';
import { IHighwayUploader } from '@/napcat-core/packet/highway/uploader/highwayUploader';
import { Frame } from '@/napcat-core/packet/highway/frame';
import * as proto from '@/napcat-core/packet/transformer/proto';

export class HighwayHttpUploader extends IHighwayUploader {
  async upload (): Promise<void> {
    const controller = new AbortController();
    const { signal } = controller;
    const upload = (async () => {
      let offset = 0;
      for await (const chunk of this.trans.data) {
        if (signal.aborted) {
          throw new Error('Upload aborted due to timeout');
        }
        const block = chunk as Buffer;
        try {
          await this.uploadBlock(block, offset, signal);
        } catch (err) {
          throw new Error(`[Highway] httpUpload Error uploading block at offset ${offset}: ${err}`);
        }
        offset += block.length;
      }
    })();
    const timeout = this.timeout().catch((err) => {
      controller.abort();
      throw new Error(err.message);
    });
    try {
      await Promise.race([upload, timeout]);
    } catch (err) {
      // 失败（含超时）时释放源流，避免文件句柄泄漏；兜底方会自行重建新流
      this.trans.data.destroy();
      throw err;
    } finally {
      this.clearTimeoutTimer();
    }
  }

  private async uploadBlock (block: Buffer, offset: number, signal: AbortSignal): Promise<void> {
    const chunkMD5 = crypto.createHash('md5').update(block).digest();
    const payload = this.buildPicUpHead(offset, block.length, chunkMD5);
    const frame = Frame.pack(Buffer.from(payload), block);
    const resp = await this.httpPostHighwayContent(frame, `http://${this.trans.server}:${this.trans.port}/cgi-bin/httpconn?htcmd=0x6FF0087&uin=${this.trans.uin}`, signal);
    const [head, body] = Frame.unpack(resp);
    const headData = new NapProtoMsg(proto.RespDataHighwayHead).decode(head);
    this.logger.debug(`[Highway] httpUploadBlock: ${headData.errorCode} | ${headData.msgSegHead?.retCode} | ${headData.bytesRspExtendInfo} | ${head.toString('hex')} | ${body.toString('hex')}`);
    if (headData.errorCode !== 0) throw new Error(`[Highway] httpUploadBlock failed (code=${headData.errorCode})`);
  }

  private async httpPostHighwayContent (frame: Buffer, serverURL: string, signal: AbortSignal): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const options: http.RequestOptions = {
          method: 'POST',
          headers: {
            Connection: 'keep-alive',
            'Accept-Encoding': 'identity',
            'User-Agent': 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2)',
            'Content-Length': frame.length.toString(),
          },
        };
        const req = http.request(serverURL, options, (res) => {
          const data: Buffer[] = [];
          res.on('data', (chunk) => {
            data.push(chunk);
          });
          res.on('end', () => {
            signal.removeEventListener('abort', abortHandler);
            resolve(Buffer.concat(data));
          });
        });
        const abortHandler = () => {
          req.destroy(new Error('Upload aborted due to timeout'));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
        // 必须调用 end() 结束请求体，否则服务端收不到完整 body、响应永不返回
        req.end(frame);
        req.on('error', (error: Error) => {
          signal.removeEventListener('abort', abortHandler);
          reject(error);
        });
      } catch (error: unknown) {
        reject(new Error((error as Error).message));
      }
    });
  }
}
