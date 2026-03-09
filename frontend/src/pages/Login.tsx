import { useState } from 'react';
import { Form, Input, Button, message, Divider } from 'antd';
import { MailOutlined, LockOutlined, RightOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useAuth } from '../AuthContext';
import { useNavigate, Link } from 'react-router-dom';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.email, values.password);
      navigate('/');
    } catch (e: any) {
      message.error(e.response?.data?.error || '登录失败');
    }
    setLoading(false);
  };

  return (
    <div className="auth-container bg-grid">
      <div className="auth-card">
        <div className="auth-logo">
          <ThunderboltOutlined style={{ fontSize: 48, color: '#00d4ff', marginBottom: 16 }} />
          <h1>VMWARE<span style={{ color: '#3b82f6' }}>TENANT</span></h1>
          <p>MULTI-TENANT CLOUD MANAGEMENT</p>
        </div>

        <Form
          onFinish={onFinish}
          layout="vertical"
          size="large"
          requiredMark={false}
        >
          <Form.Item 
            name="email" 
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input 
              prefix={<MailOutlined />} 
              placeholder="邮箱地址"
              autoComplete="email"
            />
          </Form.Item>
          
          <Form.Item 
            name="password" 
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="密码"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 16 }}>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading} 
              block
              icon={<RightOutlined />}
              iconPosition="end"
            >
              {loading ? '登录中...' : '登 录'}
            </Button>
          </Form.Item>
        </Form>

        <Divider className="auth-divider">
          <span>SECURE ACCESS</span>
        </Divider>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <span style={{ color: '#64748b', fontSize: 14 }}>
            还没有账号？ 
            <Link 
              to="/register" 
              style={{ 
                color: '#00d4ff', 
                marginLeft: 8,
                fontWeight: 600,
                transition: 'all 0.2s'
              }}
            >
              立即注册 <RightOutlined style={{ fontSize: 12 }} />
            </Link>
          </span>
        </div>
      </div>
    </div>
  );
}