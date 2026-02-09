import { useEffect, useState } from 'react';
import { Table, Button, message, Space, Modal, Form, Input, Select, Switch, Drawer, Tag } from 'antd';
import { admin } from '../../api';

type NetworkPool = {
  id: number;
  environment: string;
  network_segment: string;
  gateway: string;
  subnet_mask: string;
  dns_servers: string[];
  ip_range_start: string;
  ip_range_end: string;
  total_ips: number;
  allocated_ips: number;
  is_active: boolean;
  description?: string | null;
};

type Allocation = {
  id: number;
  ip_address: string;
  status: string;
  vm_name?: string | null;
  vcenter_vm_id?: string | null;
  allocated_at?: string | null;
  released_at?: string | null;
  request_number?: string | null;
};

const environmentOptions = [
  { label: 'Development', value: 'development' },
  { label: 'Testing', value: 'testing' },
  { label: 'Production', value: 'production' }
];

const statusColors: Record<string, string> = {
  available: 'green',
  allocated: 'blue',
  reserved: 'orange'
};

export default function NetworkPools() {
  const [data, setData] = useState<NetworkPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NetworkPool | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [allocationsOpen, setAllocationsOpen] = useState(false);
  const [allocationsLoading, setAllocationsLoading] = useState(false);
  const [activePool, setActivePool] = useState<NetworkPool | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await admin.networkPools();
      setData(res.data || []);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load network pools');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  };

  const openEdit = (record: NetworkPool) => {
    setEditing(record);
    form.setFieldsValue({
      environment: record.environment,
      network_segment: record.network_segment,
      gateway: record.gateway,
      subnet_mask: record.subnet_mask,
      dns_servers: record.dns_servers || [],
      ip_range_start: record.ip_range_start,
      ip_range_end: record.ip_range_end,
      is_active: record.is_active,
      description: record.description || ''
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await admin.updateNetworkPool(editing.id, values);
        message.success('Network pool updated');
      } else {
        await admin.createNetworkPool(values);
        message.success('Network pool created');
      }
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      load();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.error || 'Save failed');
    }
  };

  const removePool = (record: NetworkPool) => {
    Modal.confirm({
      title: 'Delete network pool?',
      content: `${record.environment} - ${record.network_segment}`,
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        try {
          await admin.deleteNetworkPool(record.id);
          message.success('Network pool deleted');
          load();
        } catch (e: any) {
          message.error(e.response?.data?.error || 'Delete failed');
        }
      }
    });
  };

  const loadAllocations = async (pool: NetworkPool) => {
    setActivePool(pool);
    setAllocationsOpen(true);
    setAllocationsLoading(true);
    try {
      const res = await admin.networkPoolAllocations(pool.id);
      setAllocations(res.data || []);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load IP allocations');
    } finally {
      setAllocationsLoading(false);
    }
  };

  const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : '-');
  const formatDns = (values?: string[] | null) => (values?.length ? values.join(', ') : '-');

  const columns = [
    { title: 'Environment', dataIndex: 'environment' },
    { title: 'Network Segment', dataIndex: 'network_segment' },
    { title: 'Gateway', dataIndex: 'gateway' },
    { title: 'Subnet Mask', dataIndex: 'subnet_mask' },
    { title: 'DNS', dataIndex: 'dns_servers', render: (values: string[]) => formatDns(values) },
    {
      title: 'IP Range',
      render: (_: any, record: NetworkPool) => `${record.ip_range_start} - ${record.ip_range_end}`
    },
    {
      title: 'Usage',
      render: (_: any, record: NetworkPool) => `${record.allocated_ips}/${record.total_ips}`
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? 'active' : 'inactive'}</Tag>
    },
    {
      title: 'Actions',
      render: (_: any, record: NetworkPool) => (
        <Space>
          <Button size="small" onClick={() => loadAllocations(record)}>IP Allocations</Button>
          <Button size="small" onClick={() => openEdit(record)}>Edit</Button>
          <Button size="small" danger onClick={() => removePool(record)}>Delete</Button>
        </Space>
      )
    }
  ];

  const allocationColumns = [
    { title: 'IP Address', dataIndex: 'ip_address' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => {
        const normalized = value === 'released' ? 'available' : value;
        return <Tag color={statusColors[normalized] || 'default'}>{normalized}</Tag>;
      }
    },
    {
      title: 'VM',
      render: (_: any, record: Allocation) => record.vm_name || record.vcenter_vm_id || '-'
    },
    {
      title: 'Request',
      dataIndex: 'request_number',
      render: (value: string) => value || '-'
    },
    { title: 'Allocated At', dataIndex: 'allocated_at', render: formatDate },
    { title: 'Released At', dataIndex: 'released_at', render: formatDate }
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={openCreate}>Create Network Pool</Button>
        <Button onClick={load} loading={loading}>Refresh</Button>
      </Space>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />

      <Modal
        title={editing ? 'Edit Network Pool' : 'Create Network Pool'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        onOk={submit}
        width={720}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="environment"
            label="Environment"
            rules={[{ required: true, message: 'Environment is required' }]}
          >
            <Select options={environmentOptions} />
          </Form.Item>
          <Form.Item
            name="network_segment"
            label="Network Segment"
            rules={[{ required: true, message: 'Network segment is required' }]}
          >
            <Input placeholder="10.0.102.0/24" />
          </Form.Item>
          <Form.Item
            name="gateway"
            label="Gateway"
            rules={[{ required: true, message: 'Gateway is required' }]}
          >
            <Input placeholder="10.0.102.1" />
          </Form.Item>
          <Form.Item
            name="subnet_mask"
            label="Subnet Mask"
            rules={[{ required: true, message: 'Subnet mask is required' }]}
          >
            <Input placeholder="255.255.255.0" />
          </Form.Item>
          <Form.Item
            name="dns_servers"
            label="DNS Servers"
            rules={[{ required: true, message: 'DNS servers are required' }]}
          >
            <Select mode="tags" placeholder="8.8.8.8" />
          </Form.Item>
          <Form.Item
            name="ip_range_start"
            label="IP Range Start"
            rules={[{ required: true, message: 'Start IP is required' }]}
          >
            <Input placeholder="10.0.102.10" />
          </Form.Item>
          <Form.Item
            name="ip_range_end"
            label="IP Range End"
            rules={[{ required: true, message: 'End IP is required' }]}
          >
            <Input placeholder="10.0.102.250" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`IP Allocations${activePool ? ` - ${activePool.network_segment}` : ''}`}
        open={allocationsOpen}
        onClose={() => { setAllocationsOpen(false); setAllocations([]); }}
        width={900}
        extra={<Button onClick={() => activePool && loadAllocations(activePool)} loading={allocationsLoading}>Refresh</Button>}
      >
        <Table
          columns={allocationColumns}
          dataSource={allocations}
          rowKey="id"
          loading={allocationsLoading}
          pagination={{ pageSize: 20 }}
        />
      </Drawer>
    </div>
  );
}
