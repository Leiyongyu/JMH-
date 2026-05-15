export type CreateOrdersV2Body = {
  platform_code: number;
  store_id: string;
  orders: Array<{
    platform_order_no: string;
    site_code?: string;
    buyer_note?: string;
    receiver_country_code: string;
    receiver_name: string;
    city: string;
    address_line1: string;
    address_type?: number;
    receiver_company_name?: string;
    buyer_choose_express?: string;
    remark?: string;
    amount_currency?: string;
    customer_shipping_amount?: number;
    customer_tax_amount?: number;
    order_total_amount?: number;
    wid?: string;
    logistics_type_id?: string;
    global_purchase_time?: number;
    global_payment_time?: number;
    sender_tax_type?: number;
    sender_tax_no?: string;
    order_custom_fields?: Record<string, unknown>;
    items: Array<{
      sku?: string;
      msku?: string;
      quantity: number;
      unit_price: number;
      stock_deduction_type?: number;
      item_custom_fields?: Record<string, unknown>;
    }>;
    shipping_info?: {
      tms_waybill_no: string;
      tms_tracking_no: string;
      file_name: string;
      base64File: string;
    };
  }>;
};

export type CreateOrdersV2Data = {
  error_details: Array<{ error_message: string; platform_order_no: string }>;
  success_details: Array<{ global_order_no: string; platform_order_no: string }>;
};

export type MpOrderListV2Body = {
  offset: number;
  length: number;
  date_type?: 'update_time' | 'global_purchase_time' | 'global_delivery_time' | 'global_payment_time' | 'delivery_time';
  start_time?: number;
  end_time?: number;
  store_id?: string[];
  platform_code?: Array<number | string>;
  platform_order_nos?: string[];
  platform_order_names?: string[];
  order_status?: number;
  include_delete?: boolean;
};

export type MpOrderListV2Data = {
  total: number;
  list: Array<{
    store_id: string;
    global_order_no: string;
    status: number;
    flow_node?: number;
    status_sub?: number;
    update_time: string;
    platform_info?: Array<{
      platform_order_no?: string;
      platform_order_name?: string;
    }>;
    logistics_info?: {
      tracking_no?: string;
      waybill_no?: string;
    };
    global_delivery_time?: number;
    global_payment_time?: number;
  }>;
};

export type SellerListV2Body = {
  offset?: number;
  length?: number;
  platform_code?: Array<number | string>;
  is_sync?: number;
  status?: number;
};

export type SellerListV2Data = {
  total: number | string;
  list: Array<{
    store_id: string;
    store_name: string;
    platform_code: number | string;
    platform_name: string;
    currency: string;
    is_sync: number;
    status: number;
    sid: string;
  }>;
};
