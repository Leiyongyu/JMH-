import { Button, Card, Form, Input, App, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../auth/AuthContext';

interface LoginForm {
  account: string;
  password: string;
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const { message } = App.useApp();

  if (user) {
    navigate('/inventory', { replace: true });
  }

  const onFinish = async (values: LoginForm) => {
    setSubmitting(true);
    try {
      await login(values.account.trim(), values.password);
      message.success('登录成功');
      navigate('/inventory', { replace: true });
    } catch (err: unknown) {
      let msg = '登录失败';
      if (axios.isAxiosError(err)) {
        const body = err.response?.data?.message;
        msg =
          (typeof body === 'string' && body) ||
          (err.code === 'ERR_NETWORK'
            ? '无法连接后端：请确认已在项目根执行 pnpm dev:api（监听 3001）；VITE_API_BASE_URL 需与 API 一致；若用局域网 IP 打开前端，请在根目录 .env 设置 API_CORS_RELAX=true 后重启 API'
            : err.message || '登录失败');
      }
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #f0f2f5 0%, #e6f4ff 100%)',
        padding: 16,
      }}
    >
      <div style={{ width: 400, marginTop: -100 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Typography.Title level={2} style={{ margin: 0, color: '#1677ff' }}>
            分销中台系统
          </Typography.Title>
          <Typography.Text type="secondary">高效便捷的跨境电商分销管理平台</Typography.Text>
        </div>
        
        <Card variant="borderless" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: 12 }}>
          <Typography.Title level={4} style={{ marginBottom: 24, fontWeight: 500 }}>
            账号登录
          </Typography.Title>
          <Form<LoginForm> layout="vertical" onFinish={onFinish} size="large">
            <Form.Item
              label="管理员账号"
              name="account"
              rules={[{ required: true, message: '请输入管理员账号' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="邮箱或手机号"
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, min: 4 }]}>
              <Input.Password
                prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting} style={{ marginTop: 12, height: 45 }}>
              立即登录
            </Button>
          </Form>
        </Card>
        
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            © 2026 分销系统管理后台 · 提供技术支持
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}
