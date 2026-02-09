import { useEffect, useState } from 'react';
import { Table, Button, message, Space, Tabs, Input, Tag, Popconfirm } from 'antd';
import { Link } from 'react-router-dom';
import { resourceRequests } from '../api';

const statusColors: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  deploying: 'blue',
  deployed: 'green',
  rejected: 'red',
  failed: 'red'
};

export default function ResourceRequests() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  const load = async (page = pagination.current, pageSize = pagination.pageSize, nextSearch = search, nextStatus = status) => {
    setLoading(true);
    try {
      const res = await resourceRequests.list({
        status: nextStatus,
        search: nextSearch || undefined,
        page,
        limit: pageSize
      });
      setData(res.data.data || []);
      setPagination({
        current: page,
        pageSize,
        total: res.data.pagination?.total || 0
      });
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1, pagination.pageSize, search, status);
  }, [status]);

  const onDelete = async (id: number) => {
    try {
      await resourceRequests.delete(id);
      message.success('Request deleted');
      load(pagination.current, pagination.pageSize);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Delete failed');
    }
  };

  const columns = [
    { title: 'Request #', dataIndex: 'request_number' },
    { title: 'Purpose', dataIndex: 'purpose' },
    { title: 'Environment', dataIndex: 'environment' },
    { title: 'VM Count', dataIndex: 'vm_count' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: string) => <Tag color={statusColors[v] || 'default'}>{v}</Tag>
    },
    { title: 'Created At', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: 'Actions',
      render: (_: any, record: any) => (
        <Space>
          <Link to={`/resource-requests/${record.id}`}>View</Link>
          {record.status === 'pending' && (
            <Popconfirm title="Delete this request?" onConfirm={() => onDelete(record.id)}>
              <Button size="small" danger>Delete</Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ];

  const tabItems = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'deployed', label: 'Deployed' },
    { key: 'rejected', label: 'Rejected' }
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Link to="/resource-requests/create">
          <Button type="primary">Create Request</Button>
        </Link>
        <Input.Search
          placeholder="Search by request number or purpose"
          allowClear
          onSearch={(value) => {
            const nextSearch = value.trim();
            setSearch(nextSearch);
            load(1, pagination.pageSize, nextSearch, status);
          }}
          style={{ width: 320 }}
        />
      </Space>
      <Tabs
        activeKey={status || 'all'}
        onChange={(key) => setStatus(key === 'all' ? undefined : key)}
        items={tabItems}
      />
      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true
        }}
        onChange={(pager) => load(pager.current || 1, pager.pageSize || pagination.pageSize, search, status)}
      />
    </div>
  );
}
