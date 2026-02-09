import { BrowserRouter, Routes, Route, Navigate, Link, Outlet } from 'react-router-dom';
import { Layout, Menu, Button, Spin } from 'antd';
import { UserOutlined, DesktopOutlined, DollarOutlined, FolderOutlined, LogoutOutlined, SettingOutlined, FormOutlined, HddOutlined, GlobalOutlined } from '@ant-design/icons';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import Projects from './pages/Projects';
import VMs from './pages/VMs';
import DailyBilling from './pages/DailyBilling';
import ResourceRequests from './pages/ResourceRequests';
import CreateResourceRequest from './pages/CreateResourceRequest';
import ResourceRequestDetail from './pages/ResourceRequestDetail';
import AdminUsers from './pages/admin/Users';
import AdminPricing from './pages/admin/Pricing';
import AdminProjects from './pages/admin/Projects';
import AdminVMs from './pages/admin/VMs';
import AdminResourceRequests from './pages/admin/ResourceRequests';
import AdminResourceRequestDetail from './pages/admin/ResourceRequestDetail';
import AdminGPUInventory from './pages/admin/GPUInventory';
import AdminNetworkPools from './pages/admin/NetworkPools';
import DeploymentLogs from './pages/admin/DeploymentLogs';

const { Header, Sider, Content } = Layout;

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 200 }} />;
  return user ? <>{children}</> : <Navigate to="/login" />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 200 }} />;
  if (!user) return <Navigate to="/login" />;
  if (user.role !== 'admin') return <Navigate to="/" />;
  return <>{children}</>;
}

function UserLayout() {
  const { user, logout } = useAuth();

  const menuItems = [
    { key: 'resource-requests', icon: <FormOutlined />, label: <Link to="/resource-requests">Resource Requests</Link> },
    { key: 'projects', icon: <FolderOutlined />, label: <Link to="/projects">项目</Link> },
    { key: 'vms', icon: <DesktopOutlined />, label: <Link to="/vms">虚拟机</Link> },
    { key: 'billing', icon: <DollarOutlined />, label: <Link to="/billing">账单</Link> },
    ...(user?.role === 'admin' ? [{ key: 'admin', icon: <SettingOutlined />, label: <Link to="/admin">管理后台</Link> }] : [])
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider>
        <div style={{ color: '#fff', padding: 16, fontSize: 16, fontWeight: 'bold' }}>VMware 租户管理</div>
        <Menu theme="dark" mode="inline" items={menuItems} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ marginRight: 16 }}><UserOutlined /> {user?.email}</span>
          <Button icon={<LogoutOutlined />} onClick={logout}>退出</Button>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}

function AdminLayout() {
  const { user, logout } = useAuth();

  const menuItems = [
    { key: 'gpu-inventory', icon: <HddOutlined />, label: <Link to="/admin/gpu-inventory">GPU Inventory</Link> },
    { key: 'network-pools', icon: <GlobalOutlined />, label: <Link to="/admin/network-pools">Network Pools</Link> },
    { key: 'resource-requests', icon: <FormOutlined />, label: <Link to="/admin/resource-requests">Resource Requests</Link> },
    { key: 'users', icon: <UserOutlined />, label: <Link to="/admin/users">用户管理</Link> },
    { key: 'pricing', icon: <DollarOutlined />, label: <Link to="/admin/pricing">价格管理</Link> },
    { key: 'projects', icon: <FolderOutlined />, label: <Link to="/admin/projects">项目管理</Link> },
    { key: 'vms', icon: <DesktopOutlined />, label: <Link to="/admin/vms">VM管理</Link> },
    { key: 'back', label: <Link to="/">返回用户端</Link> }
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider>
        <div style={{ color: '#fff', padding: 16, fontSize: 16, fontWeight: 'bold' }}>管理后台</div>
        <Menu theme="dark" mode="inline" items={menuItems} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ marginRight: 16 }}><UserOutlined /> {user?.email} (管理员)</span>
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
          <Route path="/register" element={<Register />} />
          <Route path="/verify/:token" element={<VerifyEmail />} />
          <Route path="/" element={<PrivateRoute><UserLayout /></PrivateRoute>}>
            <Route index element={<Navigate to="/projects" />} />
            <Route path="projects" element={<Projects />} />
            <Route path="vms" element={<VMs />} />
            <Route path="billing" element={<DailyBilling />} />
            <Route path="resource-requests" element={<ResourceRequests />} />
            <Route path="resource-requests/create" element={<CreateResourceRequest />} />
            <Route path="resource-requests/:id" element={<ResourceRequestDetail />} />
          </Route>
          <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
            <Route index element={<Navigate to="/admin/users" />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="pricing" element={<AdminPricing />} />
            <Route path="projects" element={<AdminProjects />} />
            <Route path="vms" element={<AdminVMs />} />
          <Route path="gpu-inventory" element={<AdminGPUInventory />} />
          <Route path="network-pools" element={<AdminNetworkPools />} />
          <Route path="resource-requests" element={<AdminResourceRequests />} />
          <Route path="resource-requests/:id" element={<AdminResourceRequestDetail />} />
          <Route path="resource-requests/:id/deployment-logs" element={<DeploymentLogs />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </AuthProvider>
  );
}
