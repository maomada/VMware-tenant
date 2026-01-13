import { useEffect, useState } from 'react';
import { Card, Result, Spin, Button } from 'antd';
import { useParams, Link } from 'react-router-dom';
import { auth } from '../api';

export default function VerifyEmail() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (token) {
      auth.verify(token)
        .then(() => setStatus('success'))
        .catch(e => {
          setStatus('error');
          setError(e.response?.data?.error || '验证失败');
        });
    }
  }, [token]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
      <Card style={{ width: 400 }}>
        {status === 'loading' && <Spin tip="验证中..." />}
        {status === 'success' && (
          <Result
            status="success"
            title="邮箱验证成功"
            subTitle="您现在可以登录系统了"
            extra={<Link to="/login"><Button type="primary">立即登录</Button></Link>}
          />
        )}
        {status === 'error' && (
          <Result
            status="error"
            title="验证失败"
            subTitle={error}
            extra={<Link to="/login"><Button type="primary">返回登录</Button></Link>}
          />
        )}
      </Card>
    </div>
  );
}
