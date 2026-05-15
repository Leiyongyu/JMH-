import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type EbayOfficialProductMainRow = {
  sku: string;
  item_id: string;
  title: string;
  short_description: string | null;
  price_value: string;
  price_currency: string;
  condition: string | null;
  condition_id: string | null;
  brand: string | null;
  gtin: string | null;
  category_path: string | null;
  category_id: string | null;
  seller_username: string | null;
  seller_feedback_score: number | null;
  seller_feedback_percentage: string | null;
  seller_account_type: string | null;
  item_web_url: string | null;
  item_creation_date: string | null;
  last_sync_time: string | null;
};

export type EbayOfficialProductDetailRow = {
  sku: string;
  item_id: string;
  aspect_name: string;
  aspect_value: string;
  aspect_type: string | null;
};

export type EbayOfficialProductVehicleRow = {
  sku: string;
  item_id: string;
  brand: string;
  model: string;
  year_range: string | null;
  platform: string | null;
  vehicle_type: string | null;
  engine: string | null;
  restriction: string | null;
};

@Injectable()
export class EbayOfficialProductsService {
  constructor(private readonly ds: DataSource) {}

  async bySku(sku: string): Promise<{
    main: EbayOfficialProductMainRow | null;
    details: EbayOfficialProductDetailRow[];
    vehicles: EbayOfficialProductVehicleRow[];
  }> {
    const s = String(sku || '').trim();
    if (!s) return { main: null, details: [], vehicles: [] };

    const main = await this.ds
      .query(
        `
        SELECT
          sku,item_id,title,short_description,price_value,price_currency,
          \`condition\`,condition_id,brand,gtin,category_path,category_id,
          seller_username,seller_feedback_score,seller_feedback_percentage,seller_account_type,
          item_web_url,item_creation_date,last_sync_time
        FROM ebay_products_main
        WHERE sku=?
        ORDER BY id DESC
        LIMIT 1
      `,
        [s],
      )
      .then((rows) => (rows?.[0] ? (rows[0] as EbayOfficialProductMainRow) : null));

    const details = await this.ds.query(
      `
      SELECT sku,item_id,aspect_name,aspect_value,aspect_type
      FROM ebay_product_details
      WHERE sku=?
      ORDER BY id ASC
    `,
      [s],
    ) as EbayOfficialProductDetailRow[];

    const vehicles = await this.ds.query(
      `
      SELECT sku,item_id,brand,model,year_range,platform,vehicle_type,engine,restriction
      FROM ebay_product_vehicles
      WHERE sku=?
      ORDER BY id ASC
    `,
      [s],
    ) as EbayOfficialProductVehicleRow[];

    return {
      main: main ? normalizeMain(main) : null,
      details: Array.isArray(details) ? details.map(normalizeDetail) : [],
      vehicles: Array.isArray(vehicles) ? vehicles.map(normalizeVehicle) : [],
    };
  }
}

function normalizeMain(r: EbayOfficialProductMainRow): EbayOfficialProductMainRow {
  return {
    ...r,
    sku: String(r.sku ?? ''),
    item_id: String(r.item_id ?? ''),
    title: String(r.title ?? ''),
    short_description: r.short_description === null ? null : String(r.short_description ?? ''),
    price_value: String(r.price_value ?? ''),
    price_currency: String(r.price_currency ?? ''),
    condition: r.condition === null ? null : String(r.condition ?? ''),
    condition_id: r.condition_id === null ? null : String(r.condition_id ?? ''),
    brand: r.brand === null ? null : String(r.brand ?? ''),
    gtin: r.gtin === null ? null : String(r.gtin ?? ''),
    category_path: r.category_path === null ? null : String(r.category_path ?? ''),
    category_id: r.category_id === null ? null : String(r.category_id ?? ''),
    seller_username: r.seller_username === null ? null : String(r.seller_username ?? ''),
    seller_feedback_score: r.seller_feedback_score === null ? null : Number(r.seller_feedback_score),
    seller_feedback_percentage: r.seller_feedback_percentage === null ? null : String(r.seller_feedback_percentage ?? ''),
    seller_account_type: r.seller_account_type === null ? null : String(r.seller_account_type ?? ''),
    item_web_url: r.item_web_url === null ? null : String(r.item_web_url ?? ''),
    item_creation_date: r.item_creation_date === null ? null : String(r.item_creation_date ?? ''),
    last_sync_time: r.last_sync_time === null ? null : String(r.last_sync_time ?? ''),
  };
}

function normalizeDetail(r: EbayOfficialProductDetailRow): EbayOfficialProductDetailRow {
  return {
    sku: String(r.sku ?? ''),
    item_id: String(r.item_id ?? ''),
    aspect_name: String(r.aspect_name ?? ''),
    aspect_value: String(r.aspect_value ?? ''),
    aspect_type: r.aspect_type === null ? null : String(r.aspect_type ?? ''),
  };
}

function normalizeVehicle(r: EbayOfficialProductVehicleRow): EbayOfficialProductVehicleRow {
  return {
    sku: String(r.sku ?? ''),
    item_id: String(r.item_id ?? ''),
    brand: String(r.brand ?? ''),
    model: String(r.model ?? ''),
    year_range: r.year_range === null ? null : String(r.year_range ?? ''),
    platform: r.platform === null ? null : String(r.platform ?? ''),
    vehicle_type: r.vehicle_type === null ? null : String(r.vehicle_type ?? ''),
    engine: r.engine === null ? null : String(r.engine ?? ''),
    restriction: r.restriction === null ? null : String(r.restriction ?? ''),
  };
}

