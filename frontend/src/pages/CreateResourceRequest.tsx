import { useEffect, useState } from 'react';
import { Form, Input, Select, Button, message, Space, Card, InputNumber, Checkbox } from 'antd';
import { MinusCircleOutlined, PlusOutlined, ThunderboltOutlined, SaveOutlined } from '@ant-design/icons';
import { projects, resourceRequests } from '../api';
import { useNavigate } from 'react-router-dom';

export default function CreateResourceRequest() {
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const res = await projects.list();
        setProjectOptions(res.data.map((p: any) => ({
          label: p.project_code ? `${p.name} (${p.project_code})` : p.name,
          value: p.id
        })));
      } catch (e: any) {
        message.error(e.response?.data?.error || 'Failed to load projects');
      }
    };
    loadProjects();
  }, []);

  const onFinish = async (values: any) => {
    const payload = {
      purpose: values.purpose,
      environment: values.environment,
      project_id: values.project_id || undefined,
      vm_items: (values.vm_items || []).map((item: any) => {
        const requiresGpu = !!item.requires_gpu;
        return {
          template_name: item.template_name,
          cpu_cores: item.cpu_cores,
          memory_gb: item.memory_gb,
          disk_gb: item.disk_gb,
          requires_gpu: requiresGpu,
          gpu_model: requiresGpu ? item.gpu_model : undefined,
          gpu_count: requiresGpu ? item.gpu_count : 0
        };
      })
    };

    setSubmitting(true);
    try {
      const res = await resourceRequests.create(payload);
      message.success('Request created');
      navigate(`/resource-requests/${res.data.id}`);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-title">
        <ThunderboltOutlined style={{ color: '#8b5cf6' }} />
        创建资源申请
      </div>

      <Card 
        style={{ 
          background: 'var(--bg-card)', 
          border: '1px solid var(--border-color)',
          marginBottom: 24
        }}
      >
        <Form
          layout="vertical"
          form={form}
          onFinish={onFinish}
          initialValues={{ vm_items: [{ requires_gpu: false }] }}
        >
          <Form.Item
            name="purpose"
            label="申请用途"
            rules={[
              { required: true, message: '请输入申请用途' },
              { min: 10, message: '用途描述至少10个字符' },
              { max: 500, message: '用途描述最多500个字符' }
            ]}
          >
            <Input.TextArea 
              rows={4} 
              placeholder="请详细描述资源申请的目的和用途..." 
              style={{ 
                fontFamily: "'IBM Plex Mono', monospace",
                background: 'var(--bg-tertiary)'
              }}
            />
          </Form.Item>

          <Space size="large" style={{ display: 'flex', marginBottom: 24 }}>
            <Form.Item
              name="environment"
              label="环境"
              rules={[{ required: true, message: '请选择环境' }]}
              style={{ minWidth: 200 }}
            >
              <Select
                options={[
                  { label: 'Development 开发环境', value: 'development' },
                  { label: 'Testing 测试环境', value: 'testing' },
                  { label: 'Production 生产环境', value: 'production' }
                ]}
                placeholder="选择环境"
              />
            </Form.Item>
            <Form.Item name="project_id" label="关联项目 (可选)" style={{ minWidth: 300 }}>
              <Select
                allowClear
                options={projectOptions}
                placeholder="选择项目"
              />
            </Form.Item>
          </Space>

          <Form.List
            name="vm_items"
            rules={[
              {
                validator: async (_, value) => {
                  if (!value || value.length < 1) {
                    return Promise.reject(new Error('至少需要1个VM配置'));
                  }
                  if (value.length > 10) {
                    return Promise.reject(new Error('最多允许10个VM配置'));
                  }
                  return Promise.resolve();
                }
              }
            ]}
          >
            {(fields, { add, remove }) => (
              <div>
                {fields.map((field, index) => (
                  <Card
                    key={field.key}
                    title={
                      <Space>
                        <ThunderboltOutlined style={{ color: '#00d4ff' }} />
                        VM 配置 #{index + 1}
                      </Space>
                    }
                    style={{ 
                      marginBottom: 16, 
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)'
                    }}
                    extra={fields.length > 1 ? (
                      <Button
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                      >
                        移除
                      </Button>
                    ) : null}
                  >
                    <Form.Item
                      {...field}
                      name={[field.name, 'template_name']}
                      label="模板名称"
                      rules={[{ required: true, message: '请输入模板名称' }]}
                    >
                      <Input placeholder="例如: ubuntu-20.04-server" />
                    </Form.Item>

                    <Space size="large" wrap>
                      <Form.Item
                        {...field}
                        name={[field.name, 'cpu_cores']}
                        label="CPU 核心"
                        rules={[{ required: true, message: '请输入CPU核心数' }]}
                      >
                        <InputNumber 
                          min={1} 
                          max={64} 
                          style={{ width: '100%' }}
                          placeholder="1-64"
                        />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'memory_gb']}
                        label="内存 (GB)"
                        rules={[{ required: true, message: '请输入内存大小' }]}
                      >
                        <InputNumber 
                          min={1} 
                          max={512} 
                          style={{ width: '100%' }}
                          placeholder="1-512"
                        />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'disk_gb']}
                        label="磁盘 (GB)"
                        rules={[{ required: true, message: '请输入磁盘大小' }]}
                      >
                        <InputNumber 
                          min={1} 
                          max={4096} 
                          style={{ width: '100%' }}
                          placeholder="1-4096"
                        />
                      </Form.Item>
                    </Space>

                    <Form.Item
                      {...field}
                      name={[field.name, 'requires_gpu']}
                      valuePropName="checked"
                      style={{ marginTop: 16, marginBottom: 8 }}
                    >
                      <Checkbox style={{ color: '#f1f5f9' }}>
                        <Space>
                          <ThunderboltOutlined style={{ color: '#8b5cf6' }} />
                          需要 GPU 加速
                        </Space>
                      </Checkbox>
                    </Form.Item>

                    <Form.Item shouldUpdate={(prev, cur) =>
                      prev.vm_items?.[field.name]?.requires_gpu !== cur.vm_items?.[field.name]?.requires_gpu
                    }>
                      {() => {
                        const requiresGpu = form.getFieldValue(['vm_items', field.name, 'requires_gpu']);
                        return (
                          <Space size="large" wrap>
                            <Form.Item
                              {...field}
                              name={[field.name, 'gpu_model']}
                              label="GPU 型号"
                              rules={[
                                {
                                  validator: async (_, value) => {
                                    if (!requiresGpu) return Promise.resolve();
                                    if (!value) return Promise.reject(new Error('请输入GPU型号'));
                                    return Promise.resolve();
                                  }
                                }
                              ]}
                            >
                              <Input 
                                placeholder="例如: NVIDIA A100" 
                                disabled={!requiresGpu}
                              />
                            </Form.Item>
                            <Form.Item
                              {...field}
                              name={[field.name, 'gpu_count']}
                              label="GPU 数量"
                              rules={[
                                {
                                  validator: async (_, value) => {
                                    if (!requiresGpu) return Promise.resolve();
                                    if (!value || value < 1 || value > 8) {
                                      return Promise.reject(new Error('GPU数量为1-8'));
                                    }
                                    return Promise.resolve();
                                  }
                                }
                              ]}
                            >
                              <InputNumber 
                                min={requiresGpu ? 1 : 0} 
                                max={8} 
                                disabled={!requiresGpu}
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                          </Space>
                        );
                      }}
                    </Form.Item>
                  </Card>
                ))}

                <Form.Item>
                  <Button
                    type="dashed"
                    onClick={() => add({ requires_gpu: false })}
                    icon={<PlusOutlined />}
                    disabled={fields.length >= 10}
                    block
                    style={{ 
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    添加 VM 配置 (最多10个)
                  </Button>
                </Form.Item>
              </div>
            )}
          </Form.List>

          <Form.Item style={{ marginTop: 32 }}>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={submitting}
              icon={<SaveOutlined />}
              size="large"
              style={{ 
                background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
                border: 'none',
                minWidth: 200
              }}
            >
              {submitting ? '提交中...' : '提交申请'}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}