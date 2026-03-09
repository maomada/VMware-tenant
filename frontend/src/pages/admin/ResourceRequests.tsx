import { useEffect, useState } from 'react';
import { Table, Button, message, Space, Tabs, Input, Tag, Select, Row, Col, Card, Statistic } from 'antd';
import { Link } from 'react-router-dom';
import {
  admin,
  getApiErrorMessage,
  type EnvironmentType,
  type RequestStatus,
  type ResourceRequestStats,
  type ResourceRequestSummary
} from '../../api';
import { formatDateTime, getEnvironmentLabel, getRequestStatusLabel } from '../../utils/display';

const statusColors: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  deploying: 'blue',
  deployed: 'green',
  rejected: 'red',
  failed: 'red'
};

export default function AdminResourceRequests() {
  const [data, setData] = useState<ResourceRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<RequestStatus | undefined>();
  const [environment, setEnvironment] = useState<EnvironmentType | undefined>();
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [stats, setStats] = useState<ResourceRequestStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const load = async (
    page = pagination.current,
    pageSize = pagination.pageSize,
    nextSearch = search,
    nextStatus = status,
    nextEnvironment = environment
  ) => {
    setLoading(true);
    try {
      const res = await admin.resourceRequests({
        status: nextStatus,
        environment: nextEnvironment,
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

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const res = await admin.resourceRequestStats();
      setStats(res.data || null);
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, 'Failed to load stats'));
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    load(1, pagination.pageSize, search, status, environment);
  }, [status, environment]);

  useEffect(() => {
    loadStats();
  }, []);

  const columns = [
    { title: 'Request #', dataIndex: 'request_number' },
    { title: 'Requester', dataIndex: 'user_name' },
    { title: 'Purpose', dataIndex: 'purpose' },
    { title: 'Environment', dataIndex: 'environment', render: (v: EnvironmentType) => getEnvironmentLabel(v) },
    { title: 'VM Count', dataIndex: 'vm_count' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: RequestStatus) => <Tag color={statusColors[v] || 'default'}>{getRequestStatusLabel(v)}</Tag>
    },
    { title: 'Created At', dataIndex: 'created_at', render: (v: string) => formatDateTime(v) },
    {
      title: 'Actions',
      render: (_: unknown, record: ResourceRequestSummary) => (
        <Space>
          <Link to={`/admin/resource-requests/${record.id}`}>View</Link>
        </Space>
      )
    }
  ];

  const tabItems = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'deploying', label: 'Deploying' },
    { key: 'deployed', label: 'Deployed' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'failed', label: 'Failed' }
  ];

  const statusCounts = stats?.status_counts || {
    pending: 0,
    approved: 0,
    deploying: 0,
    deployed: 0,
    rejected: 0,
    failed: 0
  };
  const totalRequests = Object.values(statusCounts).reduce<number>((sum, value) => sum + (Number(value) || 0), 0);
  const pendingCount = Number(statusCounts.pending || 0);
  const deployedCount = Number(statusCounts.deployed || 0);
  const failedCount = Number(statusCounts.failed || 0);
  const successRate = deployedCount + failedCount > 0
    ? Math.round((deployedCount / (deployedCount + failedCount)) * 100)
    : 0;
  const environmentCounts = stats?.environment_counts || {
    development: 0,
    testing: 0,
    production: 0
  };
  const gpuUsage = stats?.gpu_usage || [];
  const dailyRequests = stats?.daily_requests || [];

  const gpuColumns = [
    { title: 'GPU Model', dataIndex: 'gpu_model' },
    { title: 'Count', dataIndex: 'count' }
  ];

  const trendColumns = [
    { title: 'Date', dataIndex: 'date' },
    { title: 'Requests', dataIndex: 'count' }
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card loading={statsLoading}>
            <Statistic title="Total Requests" value={totalRequests} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={statsLoading}>
            <Statistic title="Pending" value={pendingCount} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={statsLoading}>
            <Statistic title="Deployed" value={deployedCount} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={statsLoading}>
            <Statistic title="Deploy Success Rate" value={successRate} suffix="%" />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8} md={8}>
          <Card loading={statsLoading}>
            <Statistic title="Deployed (Development)" value={environmentCounts.development || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={8} md={8}>
          <Card loading={statsLoading}>
            <Statistic title="Deployed (Testing)" value={environmentCounts.testing || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={8} md={8}>
          <Card loading={statsLoading}>
            <Statistic title="Deployed (Production)" value={environmentCounts.production || 0} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card title="GPU Usage" loading={statsLoading}>
            <Table
              columns={gpuColumns}
              dataSource={gpuUsage}
              rowKey="gpu_model"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Last 7 Days" loading={statsLoading}>
            <Table
              columns={trendColumns}
              dataSource={dailyRequests}
              rowKey="date"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="Search by request number or purpose"
          allowClear
          onSearch={(value) => {
            const nextSearch = value.trim();
            setSearch(nextSearch);
            load(1, pagination.pageSize, nextSearch, status, environment);
          }}
          style={{ width: 320 }}
        />
        <Select
          placeholder="Environment"
          allowClear
          style={{ width: 200 }}
          value={environment}
          onChange={(value) => setEnvironment(value as EnvironmentType | undefined)}
          options={[
            { label: 'Development', value: 'development' },
            { label: 'Testing', value: 'testing' },
            { label: 'Production', value: 'production' }
          ]}
        />
        <Button onClick={() => { setStatus(undefined); setEnvironment(undefined); setSearch(''); load(1, pagination.pageSize, '', undefined, undefined); }}>
          重置筛选
        </Button>
      </Space>
      <Tabs
        activeKey={status || 'all'}
        onChange={(key) => setStatus(key === 'all' ? undefined : (key as RequestStatus))}
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
        onChange={(pager) => load(pager.current || 1, pager.pageSize || pagination.pageSize, search, status, environment)}
      />


    </div>
  );
}
