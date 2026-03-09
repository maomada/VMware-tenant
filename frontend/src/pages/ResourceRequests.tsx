import { useEffect, useState } from 'react';
import { Table, Button, message, Space, Tabs, Input, Tag, Popconfirm } from 'antd';
import { Link } from 'react-router-dom';
import { FormOutlined, DeleteOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { resourceRequests } from '../api';

const statusColors: Record<string, { bg: string, color: string }> = {
  pending: { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' },
  approved: { bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' },
  deploying: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
  deployed: { bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' },
  rejected: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' },
  failed: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }
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
    { 
      title: 'Request #', 
      dataIndex: 'request_number',
      render: (v: string) => (
        <code style={{ 
          background: 'rgba(0, 212, 255, 0.1)', 
          padding: '2px 8px', 
          borderRadius: 4, 
          color: '#00d4ff',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12
        }}>{v}</code>
      )
    },
    { title: 'Purpose', dataIndex: 'purpose', ellipsis: true },
    { title: 'Environment', dataIndex: 'environment', render: (v: string) => (
      <Tag style={{ 
        background: 'rgba(139, 92, 246, 0.15)', 
        border: 'none', 
        color: '#8b5cf6' 
      }}>{v.toUpperCase()}</Tag>
    )},
    { title: 'VM Count', dataIndex: 'vm_count', render: (v: number) => (
      <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{v}</span>
    )},
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: string) => {
        const style = statusColors[v] || { bg: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8' };
        return (
          <Tag style={{ 
            background: style.bg, 
            border: 'none', 
            color: style.color 
          }}>
            {v.toUpperCase()}
          </Tag>
        );
      }
    },
    { 
      title: 'Created At', 
      dataIndex: 'created_at', 
      render: (v: string) => (
        <span style={{ color: '#94a3b8', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
          {new Date(v).toLocaleString()}
        </span>
      )
    },
    {
      title: 'Actions',
      render: (_: any, record: any) => (
        <Space size="small">
          <Link to={`/resource-requests/${record.id}`}>
            <Button 
              size="small" 
              icon={<EyeOutlined />}
              style={{ 
                background: 'rgba(0, 212, 255, 0.1)',
                borderColor: 'rgba(0, 212, 255, 0.3)',
                color: '#00d4ff'
              }}
            >
              查看
            </Button>
          </Link>
          {record.status === 'pending' && (
            <Popconfirm title="Delete this request?" onConfirm={() => onDelete(record.id)}>
              <Button 
                size="small" 
                danger
                icon={<DeleteOutlined />}
              >
                删除
              </Button>
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
      <div className="page-title">
        <FormOutlined style={{ color: '#8b5cf6' }} />
        资源申请
      </div>
      
      <Space style={{ marginBottom: 24 }}>
        <Link to="/resource-requests/create">
          <Button 
            type="primary" 
            icon={<PlusOutlined />}
            style={{ 
              background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
              border: 'none'
            }}
          >
            创建申请
          </Button>
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
        style={{ marginBottom: 24 }}
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
        scroll={{ x: 1000 }}
      />
    </div>
  );
}