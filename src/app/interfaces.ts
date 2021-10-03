
export interface TrendObserver {
  product_id: string;
  price: number;
  size: number;
}

export interface Ticker {
  product_id: string;
  price: number;
  sequence: number;
  type: string;
  trade_id: number;
  time: Date;
  side: string;
  last_size: number;
  best_bid: number;
  best_ask: number;
}

export interface Fill {
  created_at: Date;
  fee: number;
  liquidity: string;
  order_id: string;
  price: number;
  product_id: string;
  profile_id: string;
  settled: true
  side: string;
  size: number;
  trade_id: number;
  usd_volume: number;

}

export interface Currency {
  convertible_to: any;
  details: any;
  id: string;
  max_precision: number;
  message: string;
  min_size: number;
  name: string;
}

export interface Product {
  base_currency: string;
  base_increment: number;
  base_max_size: number;
  base_min_size: number;
  cancel_only: boolean;
  display_name: string;
  fx_stablecoin: boolean;
  id: string;
  limit_only: boolean;
  margin_enabled: boolean;
  max_market_funds: number;
  max_slippage_percentage: number;
  min_market_funds: number;
  post_only: boolean;
  quote_currency: string;
  quote_increment: number;
  status: string;
  status_message: string;
}

export interface  Account {
  available: number;
  balance: number;
  currency: string,
  hold: number;
  id: string;
  profile_id: string;
  trading_enabled: boolean;
}


export interface OrdersMarketParams {
  size?: number;
  funds?: number;
}
export interface OrdersLimitParams {
  price: number;
  size: number;
}
