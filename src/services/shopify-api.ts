import axios from 'axios';
import { ShopifyCustomer, ShopifyOrder, ShopifyProduct, TenantConfig } from '../types/shopify';

export class ShopifyAPIService {
  private baseUrl: string;
  private accessToken: string;

  constructor(shopDomain: string, accessToken: string) {
    // Sanitize the shopDomain to remove any protocol prefix
    const domain = shopDomain.replace(/^https?:\/\//, '');
    this.baseUrl = `https://${domain}/admin/api/2023-10`;
    this.accessToken = accessToken;
  }

  private async makeRequest<T>(endpoint: string, params?: any): Promise<T> {
    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        },
        params,
      });
      return response.data;
    } catch (error) {
      console.error(`Shopify API Error for ${endpoint}:`, error);
      throw error;
    }
  }

  async getCustomers(limit = 250, sinceId?: number): Promise<{ customers: ShopifyCustomer[] }> {
    const params: any = { limit };
    if (sinceId) params.since_id = sinceId;
    return this.makeRequest('/customers.json', params);
  }

  async getOrders(limit = 250, sinceId?: number): Promise<{ orders: ShopifyOrder[] }> {
    const params: any = { limit, status: 'any' };
    if (sinceId) params.since_id = sinceId;
    return this.makeRequest('/orders.json', params);
  }

  async getProducts(limit = 250, sinceId?: number): Promise<{ products: ShopifyProduct[] }> {
    const params: any = { limit };
    if (sinceId) params.since_id = sinceId;
    return this.makeRequest('/products.json', params);
  }

  async getShopInfo(): Promise<any> {
    return this.makeRequest('/shop.json');
  }

  async getCheckouts(limit = 250, sinceId?: number): Promise<any> {
    const params: any = { limit };
    if (sinceId) params.since_id = sinceId;
    return this.makeRequest('/checkouts.json', params);
  }
}
