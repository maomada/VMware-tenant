import { useEffect, useState } from 'react';
import { Table, Button, Tag, message, Space, Select } from 'antd';
import { PoweroffOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { vms, projects } from '../api';

export default function VMs() {
  const [data, setData] = useState([]);
  const [projectList, setProjectList] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [vmRes, projRes] = await Promise.all([vms.list(selectedProject), projects.list()]);
      setData(vmRes.data);
      setProjectList(projRes.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [selectedProject]);

  const powerOn = async (id: number) => {
    try {
      await vms.powerOn(id);
      message.success('开机指令已发送');
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '操作失败');
    }
  };

  const powerOff = async (id: number) => {
    try {
      await vms.powerOff(id);
      message.success('关机指令已发送');
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '操作失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name' },
    { title: '项目', dataIndex: 'project_name' },
    { title: 'CPU', dataIndex: 'cpu_cores', render: (v: number) => `${v} 核` },
    { title: '内存', dataIndex: 'memory_gb', render: (v: number) => `${v} GB` },
    { title: '存储', dataIndex: 'storage_gb', render: (v: number) => `${v} GB` },
    { title: 'GPU', dataIndex: 'gpu_count' },
    {
      title: '状态', dataIndex: 'status', render: (v: string) => (
        <Tag color={v === 'POWERED_ON' ? 'green' : v === 'POWERED_OFF' ? 'red' : 'default'}>{v}</Tag>
      )
    },
    {
      title: '操作', render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<PlayCircleOutlined />} onClick={() => powerOn(record.id)} disabled={record.status === 'POWERED_ON'}>
            开机
          </Button>
          <Button size="small" icon={<PoweroffOutlined />} onClick={() => powerOff(record.id)} disabled={record.status === 'POWERED_OFF'}>
            关机
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 200 }}
          placeholder="筛选项目"
          allowClear
          value={selectedProject}
          onChange={setSelectedProject}
          options={projectList.map(p => ({ label: p.name, value: p.id }))}
        />
      </div>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
    </div>
  );
}
