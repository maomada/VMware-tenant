import { useState } from 'react';
import { Form, Input, Button, message, Result, Divider } from 'antd';
import { MailOutlined, LockOutlined, UserOutlined, RightOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { auth } from '../api';

export default function Register() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
      await auth.register(values.email, values.password);
      setSuccess(true);
    } catch (e: any) {
      message.error(e.response?.data?.error || '注册失败');
    }
    setLoading(false);
  };

  if (success) {
    return (
      <div className="auth-container bg-grid">
        <div className="auth-card">
          <div className="result-success">
            <Result
              icon={
                <div style={{ 
                  width: 80, 
                  height: 80, 
                  borderRadius: '50%', 
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto'
                }}>
                  <ThunderboltOutlined style={{ fontSize: 36, color: '#10b981' }} />
                </div>
              }
              title={<span style={{ color: '#f1f5f9' }}>注册成功</span>}
              subTitle={<span style={{ color: '#94a3b8' }}>验证邮件已发送，请查收邮箱完成验证</span>}
              extra={
                <Link to="/login">
                  <Button type="primary" size="large" icon={<RightOutlined />} iconPosition="end">
                    返回登录
                  </Button>
                </Link>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container bg-grid">
      <div className="auth-card">
        <div className="auth-logo">
          <ThunderboltOutlined style={{ fontSize: 48, color: '#00d4ff', marginBottom: 16 }} />
          <h1>VMWARE<span style={{ color: '#3b82f6' }}>TENANT</span></h1>
          <p>CREATE NEW ACCOUNT</p>
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
              { required: true, type: 'email', message: '请输入邮箱' },
              { pattern: /@leinao\.ai$/, message: '仅支持 @leinao.ai 邮箱' }
            ]}
          >
            <Input 
              prefix={<MailOutlined />} 
              placeholder="邮箱 (@leinao.ai)"
              autoComplete="email"
            />
          </Form.Item>
          
          <Form.Item 
            name="password" 
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少6位' }
            ]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="密码"
              autoComplete="new-password"
            />
          </Form.Item>
          
          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次密码不一致'));
                }
              })
            ]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="确认密码"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 16, marginTop: 32 }}>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading} 
              block
              icon={<UserOutlined />}
            >
              {loading ? '注册中...' : '创 建 账 号'}
            </Button>
          </Form.Item>
        </Form>

        <Divider className="auth-divider">
          <span>MEMBER ACCESS</span>
        </Divider>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <span style={{ color: '#64748b', fontSize: 14 }}>
            已有账号？ 
            <Link 
              to="/login" 
              style={{ 
                color: '#00d4ff', 
                marginLeft: 8,
                fontWeight: 600,
                transition: 'all 0.2s'
              }}
            >
              立即登录 <RightOutlined style={{ fontSize: 12 }} />
            </Link>
          </span>
        </div>
      </div>
    </div>
  );
}