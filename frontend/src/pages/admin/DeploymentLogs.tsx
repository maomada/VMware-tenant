import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Table, Tag, Space, Button, Progress, message, Spin } from 'antd';
import { admin, resourceRequests } from '../../api';

const levelColors: Record<string, string> = {
  info: 'blue',
  warning: 'orange',
  error: 'red',
  debug: 'default'
};

const stepOrder = [
  'preflight',
  'allocate_resources',
  'clone_vm',
  'reconfigure_vm',
  'configure_network',
  'attach_gpu',
  'power_on',
  'finalize'
];

export default function DeploymentLogs() {
  const { id } = useParams();
  const [logs, setLogs] = useState<any[]>([]);
  const [request, setRequest] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false) => {
    if (!id) return;
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [logRes, reqRes] = await Promise.all([
        admin.resourceRequestDeploymentLogs(Number(id)),
        resourceRequests.get(Number(id))
      ]);
      setLogs(logRes.data.data || []);
      setRequest(reqRes.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load deployment logs');
    } finally {
      silent ? setRefreshing(false) : setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (request?.status !== 'deploying') return;
    const timer = setInterval(() => {
      load(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [request?.status, id]);

  const progress = useMemo(() => {
    if (!logs.length) return 0;
    if (logs.some((log) => log.operation === 'finalize')) return 100;
    const completed = new Set(
      logs
        .filter((log) => log.log_level === 'info')
        .map((log) => log.operation)
        .filter((op) => stepOrder.includes(op))
    );
    return Math.min(95, Math.round((completed.size / stepOrder.length) * 100));
  }, [logs]);

  const columns = [
    {
      title: 'Time',
      dataIndex: 'created_at',
      render: (v: string) => new Date(v).toLocaleString()
    },
    {
      title: 'Step',
      dataIndex: 'operation',
      render: (v: string) => v || '-'
    },
    {
      title: 'Level',
      dataIndex: 'log_level',
      render: (v: string) => <Tag color={levelColors[v] || 'default'}>{v}</Tag>
    },
    { title: 'Message', dataIndex: 'message' }
  ];

  if (loading && !request) {
    return <Spin />;
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Link to={`/admin/resource-requests/${id}`}>
          <Button>Back</Button>
        </Link>
        <Button onClick={() => load(true)} loading={refreshing}>Refresh</Button>
      </Space>

      <div style={{ marginBottom: 16 }}>
        <Progress percent={progress} status={request?.status === 'failed' ? 'exception' : undefined} />
      </div>

      <Table
        columns={columns}
        dataSource={logs}
        rowKey="id"
        pagination={{ pageSize: 20 }}
      />
    </div>
  );
}
