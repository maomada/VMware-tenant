import { useEffect, useState } from 'react';
import { Table, Button, message, Space, Tabs, Input, Tag, Select, Modal, Form, Row, Col, Card, Statistic } from 'antd';
import { Link } from 'react-router-dom';
import { admin } from '../../api';

const statusColors: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  deploying: 'blue',
  deployed: 'green',
  rejected: 'red',
  failed: 'red'
};

export default function AdminResourceRequests() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [environment, setEnvironment] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [approveModal, setApproveModal] = useState<{ id: number } | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: number } | null>(null);
  const [stats, setStats] = useState<any | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [bulkApproveModal, setBulkApproveModal] = useState(false);
  const [bulkRejectModal, setBulkRejectModal] = useState(false);
  const [approveForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [bulkApproveForm] = Form.useForm();
  const [bulkRejectForm] = Form.useForm();

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
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const res = await admin.resourceRequestStats();
      setStats(res.data || null);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load stats');
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

  const submitApprove = async () => {
    if (!approveModal) return;
    try {
      const values = await approveForm.validateFields();
      await admin.approveResourceRequest(approveModal.id, values);
      message.success('Request approved');
      setApproveModal(null);
      approveForm.resetFields();
      load(pagination.current, pagination.pageSize);
      loadStats();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.error || 'Approve failed');
    }
  };

  const submitReject = async () => {
    if (!rejectModal) return;
    try {
      const values = await rejectForm.validateFields();
      await admin.rejectResourceRequest(rejectModal.id, values);
      message.success('Request rejected');
      setRejectModal(null);
      rejectForm.resetFields();
      load(pagination.current, pagination.pageSize);
      loadStats();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.error || 'Reject failed');
    }
  };

  const submitBulkApprove = async () => {
    if (!selectedRowKeys.length) return;
    try {
      const values = await bulkApproveForm.validateFields();
      const results = await Promise.allSettled(
        selectedRowKeys.map((id) => admin.approveResourceRequest(id, values))
      );
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failCount = results.length - successCount;
      if (successCount) message.success(`Approved ${successCount} requests`);
      if (failCount) message.error(`${failCount} approvals failed`);
      setBulkApproveModal(false);
      bulkApproveForm.resetFields();
      setSelectedRowKeys([]);
      load(pagination.current, pagination.pageSize);
      loadStats();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.error || 'Bulk approve failed');
    }
  };

  const submitBulkReject = async () => {
    if (!selectedRowKeys.length) return;
    try {
      const values = await bulkRejectForm.validateFields();
      const results = await Promise.allSettled(
        selectedRowKeys.map((id) => admin.rejectResourceRequest(id, values))
      );
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failCount = results.length - successCount;
      if (successCount) message.success(`Rejected ${successCount} requests`);
      if (failCount) message.error(`${failCount} rejections failed`);
      setBulkRejectModal(false);
      bulkRejectForm.resetFields();
      setSelectedRowKeys([]);
      load(pagination.current, pagination.pageSize);
      loadStats();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.error || 'Bulk reject failed');
    }
  };

  const columns = [
    { title: 'Request #', dataIndex: 'request_number' },
    { title: 'Requester', dataIndex: 'user_name' },
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
          <Link to={`/admin/resource-requests/${record.id}`}>View</Link>
          {record.status === 'pending' && (
            <>
              <Button size="small" type="primary" onClick={() => setApproveModal({ id: record.id })}>
                Approve
              </Button>
              <Button size="small" danger onClick={() => setRejectModal({ id: record.id })}>
                Reject
              </Button>
            </>
          )}
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

  const statusCounts = stats?.status_counts || {};
  const totalRequests = Object.values(statusCounts).reduce((sum: number, value: any) => sum + (Number(value) || 0), 0);
  const pendingCount = Number(statusCounts.pending || 0);
  const deployedCount = Number(statusCounts.deployed || 0);
  const failedCount = Number(statusCounts.failed || 0);
  const successRate = deployedCount + failedCount > 0
    ? Math.round((deployedCount / (deployedCount + failedCount)) * 100)
    : 0;
  const environmentCounts = stats?.environment_counts || {};
  const gpuUsage = stats?.gpu_usage || [];
  const dailyRequests = stats?.daily_requests || [];

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: any[]) => setSelectedRowKeys(keys as number[]),
    getCheckboxProps: (record: any) => ({
      disabled: record.status !== 'pending'
    })
  };

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
          onChange={(value) => setEnvironment(value)}
          options={[
            { label: 'Development', value: 'development' },
            { label: 'Testing', value: 'testing' },
            { label: 'Production', value: 'production' }
          ]}
        />
        <Button
          type="primary"
          disabled={!selectedRowKeys.length}
          onClick={() => setBulkApproveModal(true)}
        >
          Bulk Approve
        </Button>
        <Button
          danger
          disabled={!selectedRowKeys.length}
          onClick={() => setBulkRejectModal(true)}
        >
          Bulk Reject
        </Button>
        <span>Selected: {selectedRowKeys.length}</span>
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
        rowSelection={rowSelection}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true
        }}
        onChange={(pager) => load(pager.current || 1, pager.pageSize || pagination.pageSize, search, status, environment)}
      />

      <Modal
        title="Approve Request"
        open={!!approveModal}
        onCancel={() => { setApproveModal(null); approveForm.resetFields(); }}
        onOk={submitApprove}
      >
        <Form form={approveForm} layout="vertical">
          <Form.Item name="admin_notes" label="Admin Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Reject Request"
        open={!!rejectModal}
        onCancel={() => { setRejectModal(null); rejectForm.resetFields(); }}
        onOk={submitReject}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="rejection_reason"
            label="Rejection Reason"
            rules={[{ required: true, message: 'Rejection reason is required' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="admin_notes" label="Admin Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Bulk Approve Requests"
        open={bulkApproveModal}
        onCancel={() => { setBulkApproveModal(false); bulkApproveForm.resetFields(); }}
        onOk={submitBulkApprove}
      >
        <Form form={bulkApproveForm} layout="vertical">
          <Form.Item name="admin_notes" label="Admin Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Bulk Reject Requests"
        open={bulkRejectModal}
        onCancel={() => { setBulkRejectModal(false); bulkRejectForm.resetFields(); }}
        onOk={submitBulkReject}
      >
        <Form form={bulkRejectForm} layout="vertical">
          <Form.Item
            name="rejection_reason"
            label="Rejection Reason"
            rules={[{ required: true, message: 'Rejection reason is required' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="admin_notes" label="Admin Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
