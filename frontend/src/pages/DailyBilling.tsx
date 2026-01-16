import { useEffect, useState } from 'react';
import { Table, Button, Card, Row, Col, Statistic, message, DatePicker, Select, Space, Tabs } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { dailyBilling, projects } from '../api';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export default function DailyBilling() {
  const [bills, setBills] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [projectList, setProjectList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [selectedProject, setSelectedProject] = useState<number | undefined>();
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<'detail' | 'stats'>('detail');
  const [statsDimension, setStatsDimension] = useState<'day' | 'month' | 'quarter'>('month');

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setIsAdmin(user.role === 'admin');
    loadProjects();
    loadBills();
    loadStats();
  }, []);

  const loadProjects = async () => {
    try {
      const res = await projects.list();
      setProjectList(res.data);
    } catch (e) {
      console.error('Load projects error:', e);
    }
  };

  const loadBills = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (dateRange) {
        params.startDate = dateRange[0].format('YYYY-MM-DD');
        params.endDate = dateRange[1].format('YYYY-MM-DD');
      }
      if (selectedProject) {
        params.projectId = selectedProject;
      }
      const res = await dailyBilling.list(params);
      setBills(res.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (dimension?: 'day' | 'month' | 'quarter') => {
    setStatsLoading(true);
    try {
      const params: any = { dimension: dimension || statsDimension };
      if (dateRange) {
        params.startDate = dateRange[0].format('YYYY-MM-DD');
        params.endDate = dateRange[1].format('YYYY-MM-DD');
      }
      if (selectedProject) {
        params.projectId = selectedProject;
      }
      const res = await dailyBilling.stats(params);
      setStats(res.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setStatsLoading(false);
    }
  };

  const handleQuery = () => {
    loadBills();
    loadStats();
  };

  const handleExport = (type: 'day' | 'month' | 'quarter') => {
    const params: any = {};
    if (dateRange) {
      params.startDate = dateRange[0].format('YYYY-MM-DD');
      params.endDate = dateRange[1].format('YYYY-MM-DD');
    }
    if (selectedProject) {
      params.projectId = selectedProject;
    }
    const token = localStorage.getItem('token');
    window.open(dailyBilling.exportUrl(type, params) + `&token=${token}`, '_blank');
  };

  const handleGenerate = async () => {
    try {
      const res = await dailyBilling.generate();
      message.success(res.data.message);
      loadBills();
      loadStats();
    } catch (e: any) {
      message.error(e.response?.data?.error || '生成失败');
    }
  };

  const totalCost = bills.reduce((sum, b) => sum + parseFloat(b.daily_cost || 0), 0);
  const totalDays = bills.length;

  const statsTotalCost = stats.reduce((sum, s) => sum + Number(s.total_cost || 0), 0);
  const statsTotalDays = stats.reduce((sum, s) => sum + Number(s.bill_days || 0), 0);

  const columns = [
    { title: '项目名称', dataIndex: 'project_name', width: 150 },
    { title: '虚机名称', dataIndex: 'vm_name', width: 180 },
    { title: '虚机ID', dataIndex: 'vcenter_vm_id', width: 120 },
    {
      title: '计费日期', dataIndex: 'bill_date', width: 120,
      render: (v: string) => v?.split('T')[0]
    },
    { title: 'CPU', dataIndex: 'cpu_cores', width: 80 },
    { title: '内存(GB)', dataIndex: 'memory_gb', width: 100 },
    { title: '存储(GB)', dataIndex: 'storage_gb', width: 100 },
    { title: 'GPU', dataIndex: 'gpu_count', width: 80 },
    { title: 'GPU型号', dataIndex: 'gpu_type', width: 150, render: (v: string) => v || '-' },
    { title: '单价', dataIndex: 'unit_price', width: 80, render: (v: string) => `¥${v}` },
    { title: '当日费用', dataIndex: 'daily_cost', width: 100, render: (v: string) => <strong>¥{v}</strong> }
  ];

  const statsColumns = [
    { title: '周期', dataIndex: 'period', width: 160 },
    { title: 'VM数', dataIndex: 'vm_count', width: 120, render: (v: any) => Number(v) },
    { title: '计费天数', dataIndex: 'bill_days', width: 120, render: (v: any) => Number(v) },
    {
      title: '金额合计',
      dataIndex: 'total_cost',
      width: 160,
      render: (v: any) => <strong>¥{Number(v || 0).toFixed(2)}</strong>
    }
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs])}
          />
          <Select
            style={{ width: 200 }}
            placeholder="选择项目"
            allowClear
            value={selectedProject}
            onChange={setSelectedProject}
          >
            {projectList.map(p => (
              <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>
            ))}
          </Select>
          <Button type="primary" onClick={handleQuery} icon={<ReloadOutlined />}>查询</Button>
          <Button onClick={() => handleExport('day')} icon={<DownloadOutlined />}>按天导出</Button>
          <Button onClick={() => handleExport('month')} icon={<DownloadOutlined />}>按月导出</Button>
          <Button onClick={() => handleExport('quarter')} icon={<DownloadOutlined />}>最近三月</Button>
          {isAdmin && (
            <Button type="dashed" onClick={handleGenerate}>生成今日账单</Button>
          )}
        </Space>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'detail' | 'stats')}
        items={[
          {
            key: 'detail',
            label: '明细',
            children: (
              <>
                <Row gutter={16} style={{ marginBottom: 24 }}>
                  <Col span={6}>
                    <Card><Statistic title="账单记录数" value={totalDays} /></Card>
                  </Col>
                  <Col span={6}>
                    <Card><Statistic title="总费用" value={totalCost} prefix="¥" precision={2} /></Card>
                  </Col>
                </Row>

                <Table
                  columns={columns}
                  dataSource={bills}
                  rowKey="id"
                  loading={loading}
                  scroll={{ x: 1400 }}
                  pagination={{ pageSize: 20 }}
                />
              </>
            )
          },
          {
            key: 'stats',
            label: '统计',
            children: (
              <>
                <Card style={{ marginBottom: 16 }}>
                  <Space wrap>
                    <span>统计维度</span>
                    <Select
                      style={{ width: 160 }}
                      value={statsDimension}
                      onChange={(v) => {
                        const dim = v as 'day' | 'month' | 'quarter';
                        setStatsDimension(dim);
                        loadStats(dim);
                      }}
                    >
                      <Select.Option value="day">按日</Select.Option>
                      <Select.Option value="month">按月</Select.Option>
                      <Select.Option value="quarter">按三个月</Select.Option>
                    </Select>
                    <Button onClick={() => loadStats()} icon={<ReloadOutlined />}>刷新统计</Button>
                  </Space>
                </Card>

                <Row gutter={16} style={{ marginBottom: 24 }}>
                  <Col span={6}>
                    <Card><Statistic title="统计周期数" value={stats.length} /></Card>
                  </Col>
                  <Col span={6}>
                    <Card><Statistic title="计费天数" value={statsTotalDays} /></Card>
                  </Col>
                  <Col span={6}>
                    <Card><Statistic title="金额合计" value={statsTotalCost} prefix="¥" precision={2} /></Card>
                  </Col>
                </Row>

                <Table
                  columns={statsColumns}
                  dataSource={stats}
                  rowKey="period"
                  loading={statsLoading}
                  scroll={{ x: 800 }}
                  pagination={{ pageSize: 20 }}
                />
              </>
            )
          }
        ]}
      />
    </div>
  );
}
