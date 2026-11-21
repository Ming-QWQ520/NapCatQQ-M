import * as stream from 'node:stream';
import { createReadStream, ReadStream } from 'node:fs';
import { HighwayTcpUploader } from '@/napcat-core/packet/highway/uploader/highwayTcpUploader';
import { HighwayHttpUploader } from '@/napcat-core/packet/highway/uploader/highwayHttpUploader';
import { PacketHighwaySig } from '@/napcat-core/packet/highway/highwayContext';
import { PacketLogger } from '@/napcat-core/packet/context/loggerContext';

export interface PacketHighwayTrans {
  uin: string;
  cmd: number;
  command: string;
  data: stream.Readable;
  sum: Uint8Array;
  size: number;
  ticket: Uint8Array;
  loginSig?: Uint8Array;
  ext: Uint8Array;
  encrypt: boolean;
  timeout?: number;
  server: string;
  port: number;
}

export class PacketHighwayClient {
  sig: PacketHighwaySig;
  server: string = 'htdata3.qq.com';
  port: number = 80;
  logger: PacketLogger;

  constructor (sig: PacketHighwaySig, logger: PacketLogger, _server: string = 'htdata3.qq.com', _port: number = 80) {
    this.sig = sig;
    this.logger = logger;
  }

  changeServer (server: string, port: number) {
    this.server = server;
    this.port = port;
  }

  private buildDataUpTrans (cmd: number, data: ReadStream, fileSize: number, md5: Uint8Array, extendInfo: Uint8Array, timeout: number = 1200): PacketHighwayTrans {
    return {
      uin: this.sig.uin,
      cmd,
      command: 'PicUp.DataUp',
      data,
      sum: md5,
      size: fileSize,
      ticket: this.sig.sigSession!,
      ext: extendInfo,
      encrypt: false,
      timeout,
      server: this.server,
      port: this.port,
    } as PacketHighwayTrans;
  }

  async upload (cmd: number, data: ReadStream, fileSize: number, md5: Uint8Array, extendInfo: Uint8Array): Promise<void> {
    const trans = this.buildDataUpTrans(cmd, data, fileSize, md5, extendInfo);
    try {
      const tcpUploader = new HighwayTcpUploader(trans, this.logger);
      await tcpUploader.upload();
    } catch (e) {
      this.logger.error(`[Highway] upload failed: ${e}, fallback to http upload`);
      // 失败的流可能已被部分消费：销毁旧流并从文件重建全新流兜底，
      // 否则 HTTP 兜底会从文件中间续传（offset 与内容错位），或读到空流导致“假成功”
      data.destroy();
      const fallbackData = (typeof data.path === 'string' || Buffer.isBuffer(data.path))
        ? createReadStream(data.path, { highWaterMark: data.readableHighWaterMark })
        : data;
      const fallbackTrans = { ...trans, data: fallbackData };
      try {
        const httpUploader = new HighwayHttpUploader(fallbackTrans, this.logger);
        await httpUploader.upload();
      } catch (httpError) {
        fallbackData.destroy();
        this.logger.error(`[Highway] http upload failed: ${httpError}`);
        throw httpError;
      }
    }
  }
}
