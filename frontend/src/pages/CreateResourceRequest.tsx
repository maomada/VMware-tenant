import { useEffect, useState } from 'react';
import { Form, Input, Select, Button, message, Space, Card, InputNumber, Checkbox } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
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
    <Form
      layout="vertical"
      form={form}
      onFinish={onFinish}
      initialValues={{ vm_items: [{ requires_gpu: false }] }}
    >
      <Form.Item
        name="purpose"
        label="Purpose"
        rules={[
          { required: true, message: 'Purpose is required' },
          { min: 10, message: 'Purpose must be at least 10 characters' },
          { max: 500, message: 'Purpose must be at most 500 characters' }
        ]}
      >
        <Input.TextArea rows={4} placeholder="Describe the request purpose" />
      </Form.Item>

      <Form.Item
        name="environment"
        label="Environment"
        rules={[{ required: true, message: 'Environment is required' }]}
      >
        <Select
          options={[
            { label: 'Development', value: 'development' },
            { label: 'Testing', value: 'testing' },
            { label: 'Production', value: 'production' }
          ]}
        />
      </Form.Item>

      <Form.Item name="project_id" label="Project (optional)">
        <Select
          allowClear
          options={projectOptions}
          placeholder="Select a project"
        />
      </Form.Item>

      <Form.List
        name="vm_items"
        rules={[
          {
            validator: async (_, value) => {
              if (!value || value.length < 1) {
                return Promise.reject(new Error('At least one VM item is required'));
              }
              if (value.length > 10) {
                return Promise.reject(new Error('At most 10 VM items are allowed'));
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
                title={`VM Item ${index + 1}`}
                style={{ marginBottom: 16 }}
                extra={fields.length > 1 ? (
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => remove(field.name)}
                  >
                    Remove
                  </Button>
                ) : null}
              >
                <Form.Item
                  {...field}
                  name={[field.name, 'template_name']}
                  label="Template Name"
                  rules={[{ required: true, message: 'Template name is required' }]}
                >
                  <Input placeholder="Template name" />
                </Form.Item>

                <Space size="large" wrap>
                  <Form.Item
                    {...field}
                    name={[field.name, 'cpu_cores']}
                    label="CPU Cores"
                    rules={[{ required: true, message: 'CPU cores is required' }]}
                  >
                    <InputNumber min={1} max={64} />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    name={[field.name, 'memory_gb']}
                    label="Memory (GB)"
                    rules={[{ required: true, message: 'Memory is required' }]}
                  >
                    <InputNumber min={1} max={512} />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    name={[field.name, 'disk_gb']}
                    label="Disk (GB)"
                    rules={[{ required: true, message: 'Disk is required' }]}
                  >
                    <InputNumber min={1} max={4096} />
                  </Form.Item>
                </Space>

                <Form.Item
                  {...field}
                  name={[field.name, 'requires_gpu']}
                  valuePropName="checked"
                >
                  <Checkbox>Requires GPU</Checkbox>
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
                          label="GPU Model"
                          rules={[
                            {
                              validator: async (_, value) => {
                                if (!requiresGpu) return Promise.resolve();
                                if (!value) return Promise.reject(new Error('GPU model is required'));
                                return Promise.resolve();
                              }
                            }
                          ]}
                        >
                          <Input placeholder="GPU model" disabled={!requiresGpu} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, 'gpu_count']}
                          label="GPU Count"
                          rules={[
                            {
                              validator: async (_, value) => {
                                if (!requiresGpu) return Promise.resolve();
                                if (!value || value < 1 || value > 8) {
                                  return Promise.reject(new Error('GPU count must be 1-8'));
                                }
                                return Promise.resolve();
                              }
                            }
                          ]}
                        >
                          <InputNumber min={requiresGpu ? 1 : 0} max={8} disabled={!requiresGpu} />
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
              >
                Add VM Item
              </Button>
            </Form.Item>
          </div>
        )}
      </Form.List>

      <Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting}>
          Submit Request
        </Button>
      </Form.Item>
    </Form>
  );
}
