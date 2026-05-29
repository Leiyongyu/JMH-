import { useEffect, useMemo, useState } from 'react';
import {
  App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table,
  Tabs, Tag, Typography, Upload, Popconfirm, Tooltip, Divider,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, ReloadOutlined, UploadOutlined, EditOutlined,
  DeleteOutlined, DollarOutlined,
} from '@ant-design/icons';
import { adminApi } from '../api/modules';
import type { AdminUser, DistributorGroup } from '../api/types';

type GroupForm = { code: string; name: string; description?: string | null };

interface ProductRow {
  sku: string;
  defaultPrice: string;
  groupPrice: string | null;
  price: string;
  source: 'group' | 'default';
}

export function DistributorGroupsPage() {
  const { message } = App.useApp();

  // ── 分组 ──
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<DistributorGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DistributorGroup | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupForm] = Form.useForm<GroupForm>();

  // ── 统计 ──
  const [stats, setStats] = useState<{ totalProducts: number; groupedProducts: number; ungroupedProducts: number } | null>(null);

  // ── 分组成员 ──
  const [allDistributors, setAllDistributors] = useState<AdminUser[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [membersSaving, setMembersSaving] = useState(false);

  // ── 商品与定价 ──
  const [productsLoading, setProductsLoading] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [editingPriceSku, setEditingPriceSku] = useState<string | null>(null);
  const [editingPriceVal, setEditingPriceVal] = useState<number | null>(null);
  const [priceSaving, setPriceSaving] = useState(false);

  // ── 批量/添加 SKU ──
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);
  const [addSkuVal, setAddSkuVal] = useState('');
  const [addSkuSaving, setAddSkuSaving] = useState(false);

  // ── Tab ──
  const [activeTab, setActiveTab] = useState<'products' | 'members'>('products');

  // ========================= 数据加载 =========================

  const loadGroups = async () => {
    setLoading(true);
    try {
      const res = await adminApi.distributorGroups();
      setGroups(res);
      if (!selectedGroupId && res.length) setSelectedGroupId(res[0].id);
      if (selectedGroupId && res.every((g) => g.id !== selectedGroupId)) {
        setSelectedGroupId(res.length ? res[0].id : null);
      }
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try { setStats(await adminApi.getUngroupedStats()); } catch {}
  };

  const loadDistributors = async () => {
    try {
      const res = await adminApi.users({ role: 'DISTRIBUTOR', page: 1, pageSize: 2000 });
      setAllDistributors(res.items);
    } catch {}
  };

  const loadMembers = async (groupId: string) => {
    try {
      const res = await adminApi.distributorGroupMembers(groupId);
      setMemberIds(res.map((u) => u.id));
    } catch { setMemberIds([]); }
  };

  const loadProducts = async (groupId: string) => {
    setProductsLoading(true);
    try {
      const res = await adminApi.getGroupPrices(groupId);
      setProducts(res);
    } catch { setProducts([]); }
    finally { setProductsLoading(false); }
  };

  useEffect(() => {
    void loadGroups();
    void loadStats();
    void loadDistributors();
  }, []);

  useEffect(() => {
    if (!selectedGroupId) return;
    void loadMembers(selectedGroupId);
    void loadProducts(selectedGroupId);
  }, [selectedGroupId]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  // ========================= 分组 CRUD =========================

  const openCreate = () => {
    setEditingGroup(null);
    groupForm.resetFields();
    setGroupModalOpen(true);
  };

  const openEdit = () => {
    if (!selectedGroup) return;
    setEditingGroup(selectedGroup);
    groupForm.setFieldsValue({ code: selectedGroup.code, name: selectedGroup.name, description: selectedGroup.description });
    setGroupModalOpen(true);
  };

  const submitGroup = async () => {
    const values = await groupForm.validateFields();
    setSavingGroup(true);
    try {
      if (!editingGroup) {
        await adminApi.createDistributorGroup(values);
        message.success('创建成功');
      } else {
        await adminApi.updateDistributorGroup(editingGroup.id, values);
        message.success('更新成功');
      }
      setGroupModalOpen(false);
      setEditingGroup(null);
      await loadGroups();
      await loadStats();
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败');
    } finally {
      setSavingGroup(false);
    }
  };

  const deleteGroup = async () => {
    if (!selectedGroup) return;
    try {
      await adminApi.deleteDistributorGroup(selectedGroup.id);
      message.success('已删除');
      setSelectedGroupId(null);
      await loadGroups();
      await loadStats();
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败');
    }
  };

  // ========================= 分组成员 =========================

  const saveMembers = async () => {
    if (!selectedGroupId) return;
    setMembersSaving(true);
    try {
      await adminApi.setDistributorGroupMembers(selectedGroupId, memberIds);
      message.success('成员已保存');
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败');
    } finally {
      setMembersSaving(false);
    }
  };

  // ========================= 专属定价 =========================

  const startEditPrice = (row: ProductRow) => {
    setEditingPriceSku(row.sku);
    setEditingPriceVal(row.groupPrice ? Number(row.groupPrice) : null);
  };

  const savePrice = async (sku: string) => {
    if (!selectedGroupId) return;
    const val = editingPriceVal;
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      message.warning('请输入有效的价格');
      return;
    }
    setPriceSaving(true);
    try {
      await adminApi.addGroupPrice(selectedGroupId, sku, val.toFixed(2));
      message.success('专属价格已设置');
      setEditingPriceSku(null);
      await loadProducts(selectedGroupId);
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '设置失败');
    } finally {
      setPriceSaving(false);
    }
  };

  const resetPrice = async (sku: string) => {
    if (!selectedGroupId) return;
    try {
      await adminApi.deleteGroupPrice(selectedGroupId, sku);
      message.success('已恢复默认价格');
      await loadProducts(selectedGroupId);
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败');
    }
  };

  const removeSkuFromGroup = async (sku: string) => {
    if (!selectedGroupId) return;
    try {
      // 通过设置为空列表再逐个添加的方式移除单个 SKU
      // 后端没有单删接口，用 batch add 方式重建
      const currentSkus = products.filter((p) => p.sku !== sku).map((p) => p.sku);
      const res = await adminApi.setDistributorGroupProducts(selectedGroupId, currentSkus);
      if (res.missing?.length) {
        message.warning(`已移除 ${sku}，有 ${res.missing.length} 个 SKU 未匹配`);
      } else {
        message.success(`已移除 ${sku}`);
      }
      await loadProducts(selectedGroupId);
      await loadStats();
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '移除失败');
    }
  };

  // ========================= 批量/添加 SKU =========================

  const handleBatchSave = async () => {
    if (!selectedGroupId) return;
    setBatchSaving(true);
    try {
      const skus = batchText
        .split(/[\r\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await adminApi.setDistributorGroupProducts(selectedGroupId, skus);
      if (res.missing?.length) {
        message.warning(`成功 ${res.bound} 个中间码，${res.missing.length} 个未匹配：${res.missing.join(', ')}`);
      } else {
        message.success(`已保存 ${res.bound} 个中间码`);
      }
      setBatchModalOpen(false);
      setBatchText('');
      await loadProducts(selectedGroupId);
      await loadStats();
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败');
    } finally {
      setBatchSaving(false);
    }
  };

  const handleAddSingleSku = async () => {
    if (!selectedGroupId || !addSkuVal.trim()) return;
    setAddSkuSaving(true);
    try {
      // 取现有 SKU 列表 + 新 SKU，全量覆盖
      const existing = products.map((p) => p.sku);
      const skus = [...existing, addSkuVal.trim()];
      const res = await adminApi.setDistributorGroupProducts(selectedGroupId, skus);
      if (res.missing?.length) {
        message.warning(`${addSkuVal.trim()} 未匹配到商品，请检查 SKU 中间码是否正确`);
      } else {
        message.success(`已添加 ${addSkuVal.trim()}`);
      }
      setAddSkuVal('');
      await loadProducts(selectedGroupId);
      await loadStats();
    } catch (err: unknown) {
      message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '添加失败');
    } finally {
      setAddSkuSaving(false);
    }
  };

  // ========================= 列定义 =========================

  const productColumns = useMemo((): ColumnsType<ProductRow> => [
    {
      title: 'SKU 中间码',
      dataIndex: 'sku',
      key: 'sku',
      width: 180,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: '默认价格 (RMB)',
      dataIndex: 'defaultPrice',
      key: 'defaultPrice',
      width: 140,
      align: 'right',
      render: (v: string) => <span style={{ color: '#999' }}>{Number(v) > 0 ? `¥${Number(v).toFixed(2)}` : '—'}</span>,
    },
    {
      title: '专属价格 (RMB)',
      dataIndex: 'groupPrice',
      key: 'groupPrice',
      width: 180,
      render: (v: string | null, row: ProductRow) => {
        if (editingPriceSku === row.sku) {
          return (
            <Space.Compact>
              <InputNumber
                autoFocus
                size="small"
                style={{ width: 100 }}
                min={0}
                precision={2}
                value={editingPriceVal ?? undefined}
                onChange={(val) => setEditingPriceVal(typeof val === 'number' ? val : null)}
                onPressEnter={() => void savePrice(row.sku)}
              />
              <Button size="small" type="primary" loading={priceSaving} onClick={() => void savePrice(row.sku)}>
                确定
              </Button>
              <Button size="small" onClick={() => setEditingPriceSku(null)}>取消</Button>
            </Space.Compact>
          );
        }
        if (v) {
          return (
            <Space>
              <Typography.Text strong style={{ color: '#1677ff' }}>¥{Number(v).toFixed(2)}</Typography.Text>
              <Tooltip title="修改专属价格">
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => startEditPrice(row)} />
              </Tooltip>
            </Space>
          );
        }
        return (
          <Tooltip title="设置专属价格">
            <Button size="small" type="dashed" icon={<DollarOutlined />} onClick={() => startEditPrice(row)}>
              设专属价
            </Button>
          </Tooltip>
        );
      },
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 80,
      align: 'center',
      render: (v: 'group' | 'default') =>
        v === 'group' ? <Tag color="blue">专属</Tag> : <Tag>默认</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, row: ProductRow) => (
        <Space size={0}>
          {row.source === 'group' && (
            <Popconfirm
              title="恢复默认价格？"
              description="专属价格将被清除"
              onConfirm={() => void resetPrice(row.sku)}
              okText="确定"
              cancelText="取消"
            >
              <Button size="small" type="link" danger>恢复默认</Button>
            </Popconfirm>
          )}
          <Popconfirm
            title="从分组移除？"
            description={`移除后该 SKU 对此分组不可见`}
            onConfirm={() => void removeSkuFromGroup(row.sku)}
            okText="移除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [editingPriceSku, editingPriceVal, priceSaving, selectedGroupId, products]);

  const distributorColumns = useMemo((): ColumnsType<AdminUser> => [
    { title: '账号', dataIndex: 'email', key: 'email' },
    { title: '姓名', dataIndex: 'displayName', key: 'displayName', width: 140, render: (v: string | null) => v || '—' },
    { title: '手机号', dataIndex: 'phone', key: 'phone', width: 140, render: (v: string | null) => v || '—' },
  ], []);

  // ========================= 渲染 =========================

  const groupOptions = useMemo(
    () => groups.map((g) => ({ value: g.id, label: `${g.code} / ${g.name}` })),
    [groups],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 顶部标题 + 统计 */}
      <Card variant="borderless">
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>分销商分组管理</Typography.Title>
            {stats && (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                商品共 {stats.totalProducts}，{stats.groupedProducts} 已分组，{stats.ungroupedProducts} 未分组
              </Typography.Text>
            )}
          </Space>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => { void loadGroups(); void loadStats(); }}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建分组</Button>
          </Space>
        </Space>
      </Card>

      {/* 分组选择 + 操作 */}
      <Card variant="borderless">
        <Space wrap>
          <Typography.Text strong>当前分组：</Typography.Text>
          <Select
            style={{ width: 280 }}
            value={selectedGroupId}
            onChange={(v) => setSelectedGroupId(v)}
            options={groupOptions}
            placeholder="请选择分组"
            loading={loading}
          />
          <Button icon={<EditOutlined />} disabled={!selectedGroup} onClick={openEdit}>编辑</Button>
          <Popconfirm
            title="确认删除该分组？"
            description="成员关系、商品授权将一并清除"
            onConfirm={deleteGroup}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger disabled={!selectedGroup}>
              <DeleteOutlined /> 删除
            </Button>
          </Popconfirm>
        </Space>
      </Card>

      {/* 主体：Tab 切换 */}
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'products' | 'members')}
          style={{ padding: '0 16px' }}
          items={[
            {
              key: 'products',
              label: `📦 商品与定价${selectedGroup ? ` (${products.length})` : ''}`,
              children: (
                <div style={{ paddingBottom: 16 }}>
                  {/* 工具栏 */}
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Upload
                      accept=".xlsx"
                      showUploadList={false}
                      beforeUpload={(file) => {
                        if (!selectedGroupId) return false;
                        void (async () => {
                          try {
                            const res = await adminApi.importDistributorGroupProductsXlsx(selectedGroupId, file, 'replace');
                            if (res.missing?.length) {
                              message.warning(`导入成功 ${res.bound} 个，${res.missing.length} 个未匹配`);
                            } else {
                              message.success(`导入成功，${res.bound} 个商品`);
                            }
                            await loadProducts(selectedGroupId);
                            await loadStats();
                          } catch (err: unknown) {
                            message.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '导入失败');
                          }
                        })();
                        return false;
                      }}
                    >
                      <Button icon={<UploadOutlined />} disabled={!selectedGroupId}>导入 Excel</Button>
                    </Upload>
                    <Button
                      disabled={!selectedGroupId}
                      onClick={() => { setBatchText(''); setBatchModalOpen(true); }}
                    >
                      批量输入 SKU
                    </Button>
                    <Divider type="vertical" />
                    <Input
                      placeholder="输入 SKU 中间码，如 bmw-30315"
                      value={addSkuVal}
                      onChange={(e) => setAddSkuVal(e.target.value)}
                      style={{ width: 240 }}
                      disabled={!selectedGroupId}
                      onPressEnter={() => void handleAddSingleSku()}
                    />
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      disabled={!selectedGroupId || !addSkuVal.trim()}
                      loading={addSkuSaving}
                      onClick={() => void handleAddSingleSku()}
                    >
                      添加
                    </Button>
                  </Space>

                  {/* 商品表 */}
                  <Table
                    rowKey="sku"
                    loading={productsLoading}
                    dataSource={products}
                    columns={productColumns}
                    pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 个中间码` }}
                    locale={{ emptyText: selectedGroup ? '暂无商品，请导入 Excel 或手动添加' : '请先选择分组' }}
                  />
                </div>
              ),
            },
            {
              key: 'members',
              label: `👥 分组成员${selectedGroup ? ` (${memberIds.length})` : ''}`,
              children: (
                <div style={{ paddingBottom: 16 }}>
                  <div style={{ marginBottom: 12 }}>
                    <Button type="primary" disabled={!selectedGroupId} loading={membersSaving} onClick={() => void saveMembers()}>
                      保存成员
                    </Button>
                  </div>
                  <Table
                    rowKey="id"
                    dataSource={allDistributors}
                    columns={distributorColumns}
                    pagination={{ pageSize: 50, showSizeChanger: true }}
                    rowSelection={{
                      selectedRowKeys: memberIds,
                      onChange: (keys) => setMemberIds(keys.map(String)),
                    }}
                    locale={{ emptyText: '暂无分销商用户' }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* 批量输入 SKU 弹窗 */}
      <Modal
        open={batchModalOpen}
        title="批量输入 SKU"
        onCancel={() => setBatchModalOpen(false)}
        onOk={() => void handleBatchSave()}
        okText="保存（覆盖）"
        cancelText="取消"
        confirmLoading={batchSaving}
        destroyOnClose
      >
        <Input.TextArea
          value={batchText}
          onChange={(e) => setBatchText(e.target.value)}
          placeholder="每行一个 SKU，支持换行/逗号/分号分隔&#10;例如：&#10;BMW-30315-SILVER&#10;VLV-170054-BLACK&#10;DAS-10036&#10;&#10;系统会自动提取中间码匹配商品"
          autoSize={{ minRows: 10, maxRows: 20 }}
        />
        <Typography.Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
          💡 输入完整 SKU，系统自动取前两段作为中间码匹配。保存时全量覆盖当前分组的商品列表。
        </Typography.Text>
      </Modal>

      {/* 分组创建/编辑弹窗 */}
      <Modal
        open={groupModalOpen}
        title={editingGroup ? '编辑分组' : '新建分组'}
        onCancel={() => setGroupModalOpen(false)}
        onOk={submitGroup}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingGroup}
        destroyOnClose
      >
        <Form form={groupForm} layout="vertical">
          <Form.Item name="code" label="Code" rules={[{ required: true, message: '请输入 code' }]}>
            <Input placeholder="例如: VIP / WHOLESALE / A" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如: VIP 分销商" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
