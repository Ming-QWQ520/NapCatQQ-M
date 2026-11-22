import { Input } from '@heroui/input';
import { useLocalStorage } from '@uidotdev/usehooks';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import key from '@/const/key';

import SaveButtons from '@/components/button/save_buttons';

import WebUIManager from '@/controllers/webui_manager';

// 密码长度上限（与服务端策略一致）
const PASSWORD_MAX_LENGTH = 12;

const ChangePasswordCard = () => {
  const {
    control,
    handleSubmit: handleWebuiSubmit,
    formState: { isSubmitting, errors },
    reset,
    watch,
  } = useForm<{
    oldPassword: string;
    newPassword: string;
  }>({
    defaultValues: {
      oldPassword: '',
      newPassword: '',
    },
  });

  const navigate = useNavigate();
  const [, setToken] = useLocalStorage(key.token, '');

  // 监听旧密码的值
  const oldPasswordValue = watch('oldPassword');

  const onSubmit = handleWebuiSubmit(async (data) => {
    try {
      // 使用正常密码更新流程
      const result = await WebUIManager.updatePassword(data.oldPassword, data.newPassword);

      toast.success('修改成功');
      if (result && result.Credential) {
        // 服务端已重新签发与新密码绑定的凭证，保持登录状态
        setToken(result.Credential);
      } else {
        setToken('');
        localStorage.removeItem(key.token);
        navigate('/web_login');
      }
    } catch (error) {
      const msg = (error as Error).message;
      toast.error(`修改失败: ${msg}`);
    }
  });

  return (
    <>
      <title>修改密码 - NapCat WebUI</title>

      <Controller
        control={control}
        name='oldPassword'
        rules={{
          required: '旧密码不能为空',
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return '旧密码不能为空';
            }
            return true;
          },
        }}
        render={({ field }) => (
          <Input
            {...field}
            label='旧密码'
            placeholder='请输入旧密码'
            type='password'
            isRequired
            isInvalid={!!errors.oldPassword}
            errorMessage={errors.oldPassword?.message}
          />
        )}
      />

      <Controller
        control={control}
        name='newPassword'
        rules={{
          required: '新密码不能为空',
          minLength: {
            value: 6,
            message: '新密码至少需要6位',
          },
          validate: (value) => {
            if (!value || value.trim().length === 0) {
              return '新密码不能为空';
            }
            if (value.trim().length !== value.length) {
              return '新密码不能包含前后空格';
            }
            if (value.length > PASSWORD_MAX_LENGTH) {
              return `新密码最长不能超过${PASSWORD_MAX_LENGTH}位`;
            }
            if (value === oldPasswordValue) {
              return '新密码不能与旧密码相同';
            }
            // 检查是否包含字母
            if (!/[a-zA-Z]/.test(value)) {
              return '新密码必须包含英文';
            }
            // 检查是否包含数字
            if (!/[0-9]/.test(value)) {
              return '新密码必须包含数字';
            }
            return true;
          },
        }}
        render={({ field }) => (
          <Input
            {...field}
            label='新密码'
            placeholder='6-12位，包含英文和数字'
            type='password'
            isRequired
            isInvalid={!!errors.newPassword}
            errorMessage={errors.newPassword?.message}
          />
        )}
      />

      <SaveButtons
        onSubmit={onSubmit}
        reset={reset}
        isSubmitting={isSubmitting}
      />
    </>
  );
};

export default ChangePasswordCard;
