import { useEffect, useState } from 'react';
import { Table, Button, Tag, message, Space, Popconfirm, Modal, Input } from 'antd';
import { admin, getApiErrorMessage, type AdminUser } from '../../api';

export default function AdminUsers() {
  const [data, setData] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [passwordModal, setPasswordModal] = useState<{ id: number; username: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await admin.users();
      setData(res.data);
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleStatus = async (id: number, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
      await admin.updateUserStatus(id, newStatus);
      message.success('状态已更新');
      load();
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '操作失败'));
    }
  };

  const deleteUser = async (id: number) => {
    try {
      await admin.deleteUser(id);
      message.success('删除成功');
      load();
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '删除失败'));
    }
  };

  const updatePassword = async () => {
    if (!passwordModal || !newPassword) return;
    try {
      await admin.updatePassword(passwordModal.id, newPassword);
      message.success('密码已更新');
      setPasswordModal(null);
      setNewPassword('');
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '更新失败'));
    }
  };

  const verifyUser = async (id: number) => {
    try {
      await admin.verifyUser(id);
      message.success('用户已验证');
      load();
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '验证失败'));
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username' },
    { title: '邮箱', dataIndex: 'email' },
    { title: '角色', dataIndex: 'role', render: (v: string) => <Tag color={v === 'admin' ? 'red' : 'blue'}>{v}</Tag> },
    { title: '邮箱验证', dataIndex: 'email_verified', render: (v: boolean) => <Tag color={v ? 'green' : 'orange'}>{v ? '已验证' : '未验证'}</Tag> },
    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'red'}>{v}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作', render: (_: unknown, record: AdminUser) => record.role !== 'admin' && (
        <Space>
          {!record.email_verified && (
            <Button size="small" type="primary" onClick={() => verifyUser(record.id)}>验证邮箱</Button>
          )}
          <Button size="small" onClick={() => setPasswordModal({ id: record.id, username: record.username })}>改密码</Button>
          <Button size="small" onClick={() => toggleStatus(record.id, record.status)}>
            {record.status === 'active' ? '禁用' : '启用'}
          </Button>
          <Popconfirm title="确认删除?" onConfirm={() => deleteUser(record.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
      <Modal
        title={`修改密码 - ${passwordModal?.username}`}
        open={!!passwordModal}
        onCancel={() => { setPasswordModal(null); setNewPassword(''); }}
        onOk={updatePassword}
      >
        <Input.Password placeholder="新密码" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
      </Modal>
    </div>
  );
}
