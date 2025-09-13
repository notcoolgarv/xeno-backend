export interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  created_at: string;
  updated_at: string;
  addresses: ShopifyAddress[];
  total_spent: string;
  orders_count: number;
}

export interface ShopifyAddress {
  id: number;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  country: string;
  zip: string;
  phone?: string;
}

export interface ShopifyOrder {
  id: number;
  order_number: number;
  customer: ShopifyCustomer;
  line_items: ShopifyLineItem[];
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string;
  created_at: string;
  updated_at: string;
  shipping_address: ShopifyAddress;
  billing_address: ShopifyAddress;
}

export interface ShopifyLineItem {
  id: number;
  product_id: number;
  variant_id: number;
  quantity: number;
  price: string;
  title: string;
  variant_title: string;
  sku: string;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  created_at: string;
  updated_at: string;
  published_at: string;
  handle: string;
  tags: string;
  status: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string;
  inventory_quantity: number;
  weight: number;
  created_at: string;
  updated_at: string;
}

export interface ShopifyImage {
  id: number;
  product_id: number;
  src: string;
  alt: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface TenantConfig {
  id: string;
  shop_domain: string;
  access_token: string;
  created_at: Date;
  updated_at: Date;
}
