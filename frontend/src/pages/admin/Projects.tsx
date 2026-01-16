import { useEffect, useState } from 'react';
import { Table, Button, message, Modal, Select } from 'antd';
import { admin } from '../../api';

export default function AdminProjects() {
  const [data, setData] = useState([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editModal, setEditModal] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    const [projRes, userRes] = await Promise.all([admin.projects(), admin.users()]);
    setData(projRes.data);
    setUsers(userRes.data.filter((u: any) => u.role !== 'admin'));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openEdit = (record: any) => {
    setEditModal(record);
    setSelectedUser(record.user_id);
  };

  const saveUser = async () => {
    if (!editModal || !selectedUser) return;
    await admin.updateProjectUser(editModal.id, selectedUser);
    message.success('绑定用户已更新');
    setEditModal(null);
    load();
  };

  const columns = [
    { title: '项目名称', dataIndex: 'name' },
    { title: 'vCenter Folder', dataIndex: 'vcenter_folder_path' },
    { title: '绑定用户', dataIndex: 'username' },
    { title: '用户邮箱', dataIndex: 'user_email' },
    { title: 'VM数量', dataIndex: 'vm_count' },
    { title: '创建时间', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作', render: (_: any, record: any) => (
        <Button size="small" onClick={() => openEdit(record)}>修改绑定</Button>
      )
    }
  ];

  return (
    <div>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
      <Modal title="修改绑定用户" open={!!editModal} onCancel={() => setEditModal(null)} onOk={saveUser}>
        <Select
          style={{ width: '100%' }}
          value={selectedUser}
          onChange={setSelectedUser}
          options={users.map(u => ({ label: `${u.username} (${u.email})`, value: u.id }))}
        />
      </Modal>
    </div>
  );
}
