import { ActionName } from '@/napcat-onebot/action/router';
import { FileNapCatOneBotUUID } from 'napcat-common/src/file-uuid';
import { GetPacketStatusDepends } from '@/napcat-onebot/action/packet/GetPacketStatus';
import { Static, Type } from '@sinclair/typebox';

import { FileActionsExamples } from '../example/FileActionsExamples';

const PayloadSchema = Type.Object({
  file_id: Type.String({ description: '文件ID' }),
});

type PayloadType = Static<typeof PayloadSchema>;

const ReturnSchema = Type.Object({
  url: Type.Optional(Type.String({ description: '文件下载链接' })),
}, { description: '私聊文件URL信息' });

type ReturnType = Static<typeof ReturnSchema>;

export class GetPrivateFileUrl extends GetPacketStatusDepends<PayloadType, ReturnType> {
  override actionName = ActionName.NapCat_GetPrivateFileUrl;
  override payloadSchema = PayloadSchema;
  override returnSchema = ReturnSchema;
  override actionSummary = '获取私聊文件URL';
  override actionDescription = '获取指定私聊文件的下载链接';
  override actionTags = ['文件接口'];
  override payloadExample = FileActionsExamples.GetPrivateFileUrl.payload;
  override returnExample = FileActionsExamples.GetPrivateFileUrl.response;

  async _handle (payload: PayloadType) {
    const contextMsgFile = FileNapCatOneBotUUID.decode(payload.file_id);

    if (contextMsgFile?.fileUUID && contextMsgFile.msgId) {
      const msg = await this.core.apis.MsgApi.getMsgsByMsgId(contextMsgFile.peer, [contextMsgFile.msgId]);
      const self_id = this.core.selfInfo.uid;
      // 应找到带 fileElement 的元素，而不是取第一个元素的 file10MMd5
      // （消息带引用/回复前缀时文件元素不在首位，原写法会必然找不到）
      const file_hash = msg.msgList[0]?.elements.find(ele => ele.fileElement?.file10MMd5)?.fileElement?.file10MMd5;
      if (file_hash) {
        return {
          url: await this.core.apis.PacketApi.pkt.operation.GetPrivateFileUrl(self_id, contextMsgFile.fileUUID, file_hash),
        };
      }
    }
    throw new Error('real fileUUID not found!');
  }
}
