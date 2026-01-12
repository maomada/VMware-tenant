import { BrowserRouter, Routes, Route, Navigate, Link, Outlet } from 'react-router-dom';
import { Layout, Menu, Button, Spin } from 'antd';
import { UserOutlined, DesktopOutlined, DollarOutlined, TeamOutlined, LogoutOutlined } from '@ant-design/icons';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './pages/Login';
import Tenants from './pages/Tenants';
import VMs from './pages/VMs';
import Billing from './pages/Billing';

const { Header, Sider, Content } = Layout;

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 200 }} />;
  return user ? <>{children}</> : <Navigate to="/login" />;
}

function AppLayout() {
  const { user, logout } = useAuth();

  const menuItems = [
    { key: 'vms', icon: <DesktopOutlined />, label: <Link to="/vms">虚拟机</Link> },
    { key: 'billing', icon: <DollarOutlined />, label: <Link to="/billing">账单</Link> },
    ...(user?.role === 'admin' ? [{ key: 'tenants', icon: <TeamOutlined />, label: <Link to="/tenants">租户管理</Link> }] : [])
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider>
        <div style={{ color: '#fff', padding: 16, fontSize: 16, fontWeight: 'bold' }}>VMware 租户管理</div>
        <Menu theme="dark" mode="inline" items={menuItems} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ marginRight: 16 }}><UserOutlined /> {user?.username} ({user?.role})</span>
          <Button icon={<LogoutOutlined />} onClick={logout}>退出</Button>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route index element={<Navigate to="/vms" />} />
            <Route path="vms" element={<VMs />} />
            <Route path="billing" element={<Billing />} />
            <Route path="tenants" element={<Tenants />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
