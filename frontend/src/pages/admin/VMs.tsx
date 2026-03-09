import { useEffect, useState } from 'react';
import { Table, Button, message, Modal, Select, Tag } from 'antd';
import { admin, getApiErrorMessage, type AdminProject, type VirtualMachine } from '../../api';

export default function AdminVMs() {
  const [data, setData] = useState<VirtualMachine[]>([]);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [editModal, setEditModal] = useState<VirtualMachine | null>(null);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [vmRes, projRes] = await Promise.all([admin.vms(), admin.projects()]);
      setData(vmRes.data);
      setProjects(projRes.data);
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openEdit = (record: VirtualMachine) => {
    setEditModal(record);
    setSelectedProject(record.project_id);
  };

  const saveProject = async () => {
    if (!editModal || !selectedProject) return;
    try {
      await admin.updateVmProject(editModal.id, selectedProject);
      message.success('绑定项目已更新');
      setEditModal(null);
      load();
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '更新失败'));
    }
  };

  const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString() : '-');

  const columns = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '项目',
      dataIndex: 'project_name',
      render: (_: unknown, record: VirtualMachine) =>
        record.project_code ? `${record.project_name} (${record.project_code})` : record.project_name
    },
    { title: '用户', dataIndex: 'username' },
    { title: 'CPU', dataIndex: 'cpu_cores', render: (v: number) => `${v} 核` },
    { title: '内存', dataIndex: 'memory_gb', render: (v: number) => `${v} GB` },
    { title: '存储', dataIndex: 'storage_gb', render: (v: number) => `${v} GB` },
    { title: 'GPU数量', dataIndex: 'gpu_count' },
    { title: 'GPU型号', dataIndex: 'gpu_type', render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'create_time', render: (v: string) => formatDateTime(v) },
    { title: '结束时间', dataIndex: 'end_time', render: (v: string) => formatDateTime(v) },
    { title: '所有者', dataIndex: 'owner', render: (v: string) => v || '-' },
    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'POWERED_ON' ? 'green' : 'red'}>{v}</Tag> },
    {
      title: '操作', render: (_: unknown, record: VirtualMachine) => (
        <Button size="small" onClick={() => openEdit(record)}>修改绑定</Button>
      )
    }
  ];

  return (
    <div>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
      <Modal title="修改绑定项目" open={!!editModal} onCancel={() => setEditModal(null)} onOk={saveProject}>
        <Select
          style={{ width: '100%' }}
          value={selectedProject}
          onChange={setSelectedProject}
          options={projects.map(p => ({
            label: p.project_code ? `${p.name} (${p.project_code})` : p.name,
            value: p.id
          }))}
        />
      </Modal>
    </div>
  );
}
