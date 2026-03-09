import { useEffect, useState } from 'react';
import { Table, Button, message, Space, Tabs, Input, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { FormOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { resourceRequests, getApiErrorMessage, type EnvironmentType, type RequestStatus, type ResourceRequestSummary } from '../api';
import { formatDateTime, getEnvironmentLabel, getRequestStatusLabel } from '../utils/display';

const statusColors: Record<string, { bg: string, color: string }> = {
  pending: { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' },
  approved: { bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' },
  deploying: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
  deployed: { bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' },
  rejected: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' },
  failed: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }
};

export default function ResourceRequests() {
  const [data, setData] = useState<ResourceRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<RequestStatus | undefined>();
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
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, 'Failed to load requests'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1, pagination.pageSize, search, status);
  }, [status]);

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
    { title: 'Environment', dataIndex: 'environment', render: (v: EnvironmentType) => (
      <Tag style={{ 
        background: 'rgba(139, 92, 246, 0.15)', 
        border: 'none', 
        color: '#8b5cf6' 
      }}>{getEnvironmentLabel(v)}</Tag>
    )},
    { title: 'VM Count', dataIndex: 'vm_count', render: (v: number) => (
      <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{v}</span>
    )},
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: RequestStatus) => {
        const style = statusColors[v] || { bg: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8' };
        return (
          <Tag style={{ 
            background: style.bg, 
            border: 'none', 
            color: style.color 
          }}>
            {getRequestStatusLabel(v)}
          </Tag>
        );
      }
    },
    { 
      title: 'Created At', 
      dataIndex: 'created_at', 
      render: (v: string) => (
        <span style={{ color: '#94a3b8', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
          {formatDateTime(v)}
        </span>
      )
    },
    {
      title: 'Actions',
      render: (_: unknown, record: ResourceRequestSummary) => (
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
        </Space>
      )
    }
  ];

  const tabItems = [
    { key: 'all', label: '全部' },
    { key: 'pending', label: '待处理' },
    { key: 'approved', label: '已批准' },
    { key: 'deploying', label: '部署中' },
    { key: 'deployed', label: '已部署' },
    { key: 'rejected', label: '已驳回' },
    { key: 'failed', label: '已失败' }
  ];

  return (
    <div>
      <div className="page-title">
        <FormOutlined style={{ color: '#8b5cf6' }} />
        我的申请
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
        <Button onClick={() => { setStatus(undefined); setSearch(''); load(1, pagination.pageSize, '', undefined); }}>
          重置筛选
        </Button>
      </Space>
      
      <Tabs
        activeKey={status || 'all'}
        onChange={(key) => setStatus(key === 'all' ? undefined : (key as RequestStatus))}
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
