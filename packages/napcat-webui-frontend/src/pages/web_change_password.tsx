import { Button } from '@heroui/button';
import { CardBody, CardHeader } from '@heroui/card';
import { Image } from '@heroui/image';
import { Input } from '@heroui/input';
import { useLocalStorage } from '@uidotdev/usehooks';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { IoArrowBack, IoLockClosedOutline } from 'react-icons/io5';
import { useNavigate } from 'react-router-dom';

import logo from '@/assets/images/logo.png';

import key from '@/const/key';

import HoverEffectCard from '@/components/effect_card';
import { title } from '@/components/primitives';
import { ThemeSwitch } from '@/components/theme-switch';

import WebUIManager from '@/controllers/webui_manager';
import PureLayout from '@/layouts/pure';
import { motion } from 'motion/react';

// 与服务端一致的密码策略
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 12;

const inputClassNames = {
  label: 'text-black/50 dark:text-white/90',
  input: [
    'bg-transparent',
    'text-black/90 dark:text-white/90',
    'placeholder:text-default-700/50 dark:placeholder:text-white/60',
  ],
  innerWrapper: 'bg-transparent',
  inputWrapper: [
    'shadow-xl',
    'bg-default-100/70',
    'dark:bg-default/60',
    'backdrop-blur-xl',
    'backdrop-saturate-200',
    'hover:bg-default-0/70',
    'dark:hover:bg-default/70',
    'group-data-[focus=true]:bg-default-100/50',
    'dark:group-data-[focus=true]:bg-default/60',
    '!cursor-text',
  ],
};

function validatePassword (value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return '密码不能为空';
  }
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `密码长度不能小于${PASSWORD_MIN_LENGTH}位`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `密码长度不能超过${PASSWORD_MAX_LENGTH}位`;
  }
  if (!/[a-zA-Z]/.test(value)) {
    return '密码必须包含英文';
  }
  if (!/[0-9]/.test(value)) {
    return '密码必须包含数字';
  }
  return undefined;
}

/**
 * 首次登录后的强制修改密码页。
 *
 * 独立模式下，初始密码为服务端自动生成（输出在启动日志中），登录成功但未
 * 完成修改前，后端会拦截除改密外的全部业务接口，本页是完成初始设置的
 * 唯一出口。
 *
 * 共用密码模式下，登录密码以 AstrBot 仪表盘为准，本页只作引导提示
 * （正常流程不会跳转到这里，仅防止用户直接输入 URL 访问）。
 */
export default function WebChangePasswordPage () {
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [, setLocalToken] = useLocalStorage<string>(key.token, '');
  // 共用密码模式：密码以 AstrBot 仪表盘为准，不在本端修改
  const [sharedPassword, setSharedPassword] = useState<boolean>(false);

  const onSubmit = async () => {
    const oldError = !oldPassword ? '请输入旧密码' : undefined;
    if (oldError) {
      toast.error(oldError);
      return;
    }
    const newError = validatePassword(newPassword);
    if (newError) {
      toast.error(newError);
      return;
    }
    if (newPassword === oldPassword) {
      toast.error('新密码不能与旧密码相同');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setIsLoading(true);
    try {
      const data = await WebUIManager.updatePassword(oldPassword, newPassword);
      if (data && data.Credential) {
        // 服务端已重新签发与新密码绑定的凭证，无需重新登录
        setLocalToken(data.Credential);
      }
      toast.success('密码修改成功');
      navigate('/qq_login', { replace: true });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      onSubmit();
    }
  };

  useEffect(() => {
    WebUIManager.getLoginMode()
      .then((mode) => setSharedPassword(!!mode?.sharedPassword))
      .catch(() => { /* 查询失败按独立模式展示 */ });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [oldPassword, newPassword, confirmPassword, isLoading]);

  return (
    <>
      <title>修改初始密码 - NapCat WebUI</title>
      <PureLayout>
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, type: 'spring', stiffness: 120, damping: 20 }}
          className='w-[608px] max-w-full py-8 px-2 md:px-8 overflow-hidden'
        >
          <HoverEffectCard
            className='items-center gap-4 pt-0 pb-6 bg-default-50'
            maxXRotation={3}
            maxYRotation={3}
          >
            <CardHeader className='inline-block max-w-lg text-center justify-center'>
              <div className='flex items-center justify-center w-full gap-2 pt-10'>
                <Image alt='logo' height='7em' src={logo} />
                <div>
                  <span className={title()}>Initial&nbsp;</span>
                  <span className={title({ color: 'violet' })}>
                    Setup&nbsp;
                  </span>
                </div>
              </div>
              <ThemeSwitch className='absolute right-4 top-4' />
            </CardHeader>

            <CardBody className='flex gap-5 py-5 px-5 md:px-10'>
              {sharedPassword
                ? (
                  <>
                    <div className='text-center text-default-600 dark:text-default-400'>
                      当前为共用密码模式
                    </div>
                    <div className='text-center text-small text-default-600 dark:text-default-400 px-2'>
                      登录密码与 AstrBot 仪表盘一致（以 AstrBot 为准），
                      请前往 AstrBot 控制台修改：把地址栏中的
                      <code>/napcat/webui/...</code> 改为 <code>/</code> 即可。
                    </div>
                    <Button
                      className='mx-10 mt-6 text-lg py-7'
                      color='primary'
                      radius='full'
                      size='lg'
                      variant='shadow'
                      onPress={() => navigate('/web_login', { replace: true })}
                    >
                      返回登录
                    </Button>
                  </>
                )
                : (
                  <>
                    <div className='text-center text-default-600 dark:text-default-400'>
                      首次登录请先修改初始密码后继续使用
                    </div>
                    <div className='text-center text-small text-default-600 dark:text-default-400 px-2'>
                      密码需包含英文和数字，长度 {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} 位
                    </div>

                    <Button
                      isIconOnly
                      variant='light'
                      className='self-start -ml-2'
                      onPress={() => navigate('/web_login', { replace: true })}
                    >
                      <IoArrowBack size={20} />
                    </Button>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        onSubmit();
                      }}
                    >
                    <Input
                      type='password'
                      name='old-password'
                      autoComplete='current-password'
                      classNames={inputClassNames}
                      isDisabled={isLoading}
                      label='旧密码（初始密码）'
                      placeholder='请输入启动日志中的初始密码'
                      radius='lg'
                      size='lg'
                      startContent={
                        <IoLockClosedOutline className='text-black/50 mb-0.5 dark:text-white/90 text-slate-400 pointer-events-none flex-shrink-0' />
                    }
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                    />
                    <div className='h-4' />
                    <Input
                      type='password'
                      name='new-password'
                      autoComplete='new-password'
                      classNames={inputClassNames}
                      isDisabled={isLoading}
                      label='新密码'
                      placeholder='6-12位，包含英文和数字'
                      radius='lg'
                      size='lg'
                      startContent={
                        <IoLockClosedOutline className='text-black/50 mb-0.5 dark:text-white/90 text-slate-400 pointer-events-none flex-shrink-0' />
                    }
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <div className='h-4' />
                    <Input
                      type='password'
                      name='confirm-password'
                      autoComplete='new-password'
                      classNames={inputClassNames}
                      isDisabled={isLoading}
                      label='确认新密码'
                      placeholder='再次输入新密码'
                      radius='lg'
                      size='lg'
                      startContent={
                        <IoLockClosedOutline className='text-black/50 mb-0.5 dark:text-white/90 text-slate-400 pointer-events-none flex-shrink-0' />
                    }
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    </form>

                    <Button
                      className='mx-10 mt-6 text-lg py-7'
                      color='primary'
                      isLoading={isLoading}
                      radius='full'
                      size='lg'
                      variant='shadow'
                      onPress={onSubmit}
                    >
                      {!isLoading && (
                        <Image
                          alt='logo'
                          classNames={{
                            wrapper: '-ml-8',
                          }}
                          height='2em'
                          src={logo}
                        />
                      )}
                      确认修改
                    </Button>
                  </>
                )}
            </CardBody>
          </HoverEffectCard>
        </motion.div>
      </PureLayout>
    </>
  );
}
