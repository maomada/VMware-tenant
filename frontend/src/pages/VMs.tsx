import { useEffect, useState } from 'react';
import { Table, Button, Tag, message, Space, Modal, Form, Input, InputNumber, Select } from 'antd';
import { PoweroffOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { vms, tenants } from '../api';
import { useAuth } from '../AuthContext';

export default function VMs() {
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [tenantList, setTenantList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    const res = await vms.list();
    setData(res.data);
    if (user?.role === 'admin') {
      const t = await tenants.list();
      setTenantList(t.data);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const powerOn = async (id: number) => {
    await vms.powerOn(id);
    message.success('开机指令已发送');
    load();
  };

  const powerOff = async (id: number) => {
    await vms.powerOff(id);
    message.success('关机指令已发送');
    load();
  };

  const onCreate = async (values: any) => {
    await vms.create(values);
    message.success('创建成功');
    setModal(false);
    form.resetFields();
    load();
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name' },
    { title: 'CPU', dataIndex: 'cpu_cores', render: (v: number) => `${v} 核` },
    { title: '内存', dataIndex: 'memory_gb', render: (v: number) => `${v} GB` },
    { title: '存储', dataIndex: 'storage_gb', render: (v: number) => `${v} GB` },
    { title: 'GPU', dataIndex: 'gpu_count' },
    {
      title: '状态', dataIndex: 'status', render: (v: string) => (
        <Tag color={v === 'poweredOn' ? 'green' : v === 'poweredOff' ? 'red' : 'default'}>{v}</Tag>
      )
    },
    {
      title: '操作', render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<PlayCircleOutlined />} onClick={() => powerOn(record.id)} disabled={record.status === 'poweredOn'}>
            开机
          </Button>
          <Button size="small" icon={<PoweroffOutlined />} onClick={() => powerOff(record.id)} disabled={record.status === 'poweredOff'}>
            关机
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      {user?.role === 'admin' && (
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal(true)}>添加虚拟机</Button>
        </div>
      )}
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
      <Modal title="添加虚拟机" open={modal} onCancel={() => setModal(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="tenantId" label="租户" rules={[{ required: true }]}>
            <Select options={tenantList.map((t: any) => ({ label: t.name, value: t.id }))} />
          </Form.Item>
          <Form.Item name="vcenterVmId" label="vCenter VM ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="cpuCores" label="CPU核数" rules={[{ required: true }]}>
            <InputNumber min={1} />
          </Form.Item>
          <Form.Item name="memoryGb" label="内存(GB)" rules={[{ required: true }]}>
            <InputNumber min={1} />
          </Form.Item>
          <Form.Item name="storageGb" label="存储(GB)" rules={[{ required: true }]}>
            <InputNumber min={1} />
          </Form.Item>
          <Form.Item name="gpuCount" label="GPU数量">
            <InputNumber min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
