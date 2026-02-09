import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Descriptions, Table, Tag, Button, message, Space, Popconfirm, Spin } from 'antd';
import { resourceRequests } from '../api';

const statusColors: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  deploying: 'blue',
  deployed: 'green',
  rejected: 'red',
  failed: 'red'
};

export default function ResourceRequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await resourceRequests.get(Number(id));
      setData(res.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load request');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const onDelete = async () => {
    if (!data?.id) return;
    try {
      await resourceRequests.delete(data.id);
      message.success('Request deleted');
      navigate('/resource-requests');
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Delete failed');
    }
  };

  const vmColumns = [
    { title: 'VM Name', dataIndex: 'vm_name', render: (v: string) => v || '-' },
    { title: 'Template', dataIndex: 'template_name' },
    { title: 'CPU', dataIndex: 'cpu_cores' },
    { title: 'Memory (GB)', dataIndex: 'memory_gb' },
    { title: 'Disk (GB)', dataIndex: 'disk_gb' },
    { title: 'GPU', dataIndex: 'requires_gpu', render: (v: boolean, record: any) => (v ? `${record.gpu_model || ''} x${record.gpu_count || 0}` : 'No') },
    { title: 'IP', dataIndex: 'ip_address', render: (v: string) => v || '-' },
    { title: 'Network', dataIndex: 'network_segment', render: (v: string) => v || '-' },
    { title: 'Gateway', dataIndex: 'gateway', render: (v: string) => v || '-' },
    { title: 'DNS', dataIndex: 'dns_servers', render: (v: string[]) => (v && v.length ? v.join(', ') : '-') },
    {
      title: 'Deploy Status',
      dataIndex: 'deployment_status',
      render: (v: string) => v || '-'
    },
    { title: 'Deploy Error', dataIndex: 'deployment_error', render: (v: string) => v || '-' },
    { title: 'Deployed At', dataIndex: 'deployed_at', render: (v: string) => (v ? new Date(v).toLocaleString() : '-') }
  ];

  if (loading && !data) {
    return <Spin />;
  }

  if (!data) {
    return null;
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Link to="/resource-requests">
          <Button>Back</Button>
        </Link>
        {data.status === 'pending' && (
          <Popconfirm title="Delete this request?" onConfirm={onDelete}>
            <Button danger>Delete</Button>
          </Popconfirm>
        )}
      </Space>

      <Descriptions bordered column={2} size="small">
        <Descriptions.Item label="Request #">{data.request_number}</Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={statusColors[data.status] || 'default'}>{data.status}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Environment">{data.environment}</Descriptions.Item>
        <Descriptions.Item label="Project">{data.project_name || '-'}</Descriptions.Item>
        <Descriptions.Item label="Purpose" span={2}>{data.purpose}</Descriptions.Item>
        <Descriptions.Item label="Approver">{data.approver_name || '-'}</Descriptions.Item>
        <Descriptions.Item label="Approved At">{data.approved_at ? new Date(data.approved_at).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="Deployed At">{data.deployed_at ? new Date(data.deployed_at).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="Created At">{new Date(data.created_at).toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="Updated At">{new Date(data.updated_at).toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="Admin Notes" span={2}>{data.admin_notes || '-'}</Descriptions.Item>
        <Descriptions.Item label="Rejection Reason" span={2}>{data.rejection_reason || '-'}</Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 24 }}>
        <Table
          columns={vmColumns}
          dataSource={data.vm_items || []}
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      </div>
    </div>
  );
}
