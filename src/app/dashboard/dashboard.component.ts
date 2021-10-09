import {AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {BehaviorSubject, forkJoin, interval, Observable, of, Subject, Subscription, timer} from "rxjs";
import {filter, finalize, map, mergeMap, retry, takeUntil, tap} from "rxjs/operators";
import {HttpClient} from "@angular/common/http";
import {FormBuilder, FormControl, FormGroup, Validators} from "@angular/forms";
import {MatAutocompleteSelectedEvent} from "@angular/material/autocomplete";
import {CoinbaseProService} from "../coinbase-pro.service";
import {MatSnackBar} from "@angular/material/snack-bar";
import {WebsocketService} from "../websocket.service";
import {Alert, TrendObserver} from "../interfaces";
import {UtilsService} from "../utils.service";


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {

  public USDEUR: number = 1;

  public productsTicker: string[] = [];
  public productsGraph: string[] = [];
  public trendObserver: TrendObserver[] = [];
  public alerts: Alert[] = [];

  public currencies$: BehaviorSubject<any> = new BehaviorSubject<any>([]);
  public products$: BehaviorSubject<any> = new BehaviorSubject<any>([]);
  public accounts$: BehaviorSubject<any> = new BehaviorSubject<any>([]);
  public orders$: BehaviorSubject<any> = new BehaviorSubject<any>([]);
  public fills$: BehaviorSubject<any> = new BehaviorSubject<any>([]);
  public ticker$: BehaviorSubject<any> = new BehaviorSubject<any>(null);
  public candles$: BehaviorSubject<any> = new BehaviorSubject<any>(null);

  private intervalSub: Subscription = new Subscription();

  protected destroy$ = new Subject();

  public startedAt: number = new Date().valueOf();
  public swapLoading: boolean = false;

  constructor(
    private http: HttpClient,
    private fb: FormBuilder,
    private coinbaseProService: CoinbaseProService,
    private wsService: WebsocketService,
    private notify: MatSnackBar,
    private utils: UtilsService
  ) {}

  ngOnInit(): void {

    const storage = this.getStorage();
    this.productsGraph = storage.productsGraph || [];
    this.trendObserver = storage.trendObserver || [];
    this.alerts = storage.alerts || [];
    this.productsTicker = storage.productsTicker || [];
    this.subscribeWsTickers([
      ...this.productsTicker,
      ...this.productsGraph
    ]);

    this.loadCurrencies();
    this.loadProducts();
    this.loadAccounts();
    this.loadOrders();

    this.loadTickers();


    this.intervalSub = timer(0, 60000).subscribe((x: number) => {

      //this.utils.beep();
      this.productsGraph.forEach(productId => this.loadCandles(productId));

    });
  }

  loadCandles(productId: string) {
    /*
    time bucket start time
    low lowest price during the bucket interval
    high highest price during the bucket interval
    open opening price (first trade) in the bucket interval
    close closing price (last trade) in the bucket interval
    volume volume of trading activity during the bucket interval
    */
    this.coinbaseProService.getProductCandles(productId, {
      granularity: 60,
      start: new Date(Date.now()+1).toUTCString()
    }).pipe(
      map((v: any[]) => {

        return v.map(item => {
          const [time, low, high, open, close, volume] = item;
          //[Timestamp, O, H, L, C]
          const d = new Date(time * 1000);
          const b = d.getTimezoneOffset() * 60 * 1000;
          return [d.valueOf() - b, open, high, low, close];
        });

      })
    ).subscribe(
      result => this.candles$.next({
        name: productId,
        data: result
      }),
      err => this.candles$.error(err)
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.intervalSub.unsubscribe();
  }

  addProductOnGraph(productId: string) {
    if (!this.productsGraph.includes(productId)) {
      this.productsGraph.push(productId);
      this.addProductTicker(productId);
    }
  }
  removeProductOnGraph(productId: string) {
    const index = this.productsGraph.indexOf(productId);
    if (index >= 0) {
      this.productsGraph.splice(index, 1);
      this.removeProductTicker(productId);
    }
  }

  addAlert(item: any) {
    this.alerts.unshift(item);
    this.addProductTicker(item.product_id);
  }
  removeAlert(index: number) {
    const item = this.alerts.splice(index, 1)[0];
    this.removeProductTicker(item.product_id);
  }

  addTrendObserver(item: any) {
    this.trendObserver.unshift(item);
    this.addProductTicker(item.product_id);
  }
  removeTrendObserver(index: number) {
    const item = this.trendObserver.splice(index, 1)[0];
    this.removeProductTicker(item.product_id);
  }

  addProductTicker(productId: string) {
    if (!this.productsTicker.includes(productId)) {
      this.productsTicker.push(productId);
      this.subscribeWsTickers([productId]);
    }
  }

  removeProductTicker(productId: string) {
    this.productsTicker = this.productsTicker.filter(
      (v: string) => v !== productId
    );
    this.unsubscribeWsTickers([productId]);
  }

  getProductsTicker() {
    return this.productsTicker;
  }

  subscribeWsTickers(productIds: string[]) {
    if (!productIds.length) return;

    this.wsService.send({
      "type": "subscribe",
      "product_ids": productIds,
      "channels": [
        "ticker"
      ]
    });
  }

  unsubscribeWsTickers(productIds: string[]) {
    productIds = productIds.filter(v => v !== 'USDT-EUR');
    if (!productIds.length) {
      return;
    }

    this.wsService.send({
      "type": "unsubscribe",
      "product_ids": productIds,
      "channels": [
        "ticker"
      ]
    });
  }

  loadTickers() {
    this.wsService.connect();

    this.subscribeWsTickers(['USDT-EUR']);


    this.wsService.wsSubject$.pipe(
      retry()
    ).subscribe(
      (v: any) => {
        if (v.type === 'ticker') {
          if (v.product_id === 'USDT-EUR') {
            this.USDEUR = v.price;
          }

          this.ticker$.next(v);
        }

        if (v.type === 'subscriptions') {
          const tickerChannel = v.channels.filter((item: any) => item.name === 'ticker');
          if (tickerChannel[0]) {
            this.productsTicker = tickerChannel[0].product_ids;
          }
        }

        // it's a good place
        this.setStorage();

      }
    );
  }

  loadAccounts() {
    this.coinbaseProService.getAccounts().pipe(
      map((r: any) => {
        return r.sort((a: any, b: any) => {
          return b.available - a.available;
        });
      }),
      map((r: any) => {
        // add tickers
        r.filter(
          (item: any) => item.available > 0 && !['EUR','USDT'].includes(item.currency)
        ).map(
          (item: any) => {
            this.subscribeWsTickers([item.currency + '-EUR']);
            this.subscribeWsTickers([item.currency + '-USDT']);
          }
        );

        return r;
      })
    ).subscribe(
      result => this.accounts$.next(result),
      err => this.accounts$.error(err)
    );
  }

  loadOrders() {
    this.coinbaseProService.getOrders().subscribe(
      result => this.orders$.next(result),
      err => this.orders$.error(err)
    );
  }

  loadFills(product: any) {
    this.coinbaseProService.getFills({product_id: product.id, limit: 10}).subscribe(
      result => this.fills$.next(result),
      err => this.fills$.error(err)
    );
  }

  loadProducts() {
    this.coinbaseProService.getProducts().pipe(
      map((results: any) => {
        return results.filter(
          (item: any) => ['USDT','EUR'].includes(item.quote_currency)
        ).sort(
          (a: any, b: any) => a.id.localeCompare(b.id)
        );
      })
    ).subscribe(
      result => this.products$.next(result),
      err => this.products$.error(err)
    );
  }

  loadCurrencies() {
    this.coinbaseProService.getCurrencies().subscribe(
      result => this.currencies$.next(result),
      err => this.currencies$.error(err)
    );
  }

  fees() {
    this.coinbaseProService.getFees().subscribe((result) => {
        console.log(result);
      },
      error => console.log(error.error.message));
  }

  isUSDT(product: any) {
    return product.quote_currency === 'USDT';
  }

  isEUR(product: any) {
    return product.quote_currency === 'EUR';
  }

  extractCurrency(productId: string) {
    return productId.split('-')[1];
  }

  getAccountAvailableSize(currency: string) {
    const accounts = this.accounts$.getValue().filter(
      (item: any) => item.currency === currency
    ).map(
      (item: any) => item.available
    );

    return accounts.length ? accounts[0] : null;
  }

  swap($event: any) {

    const sellProduct = $event.sellProduct;
    const buyProduct = $event.buyProduct;
    const sellSize = $event.size;

    const sellCurrency = sellProduct.quote_currency;
    const accountPrevAvailable = this.getAccountAvailableSize(sellCurrency);

    this.swapLoading = true;
    this.coinbaseProService.sellMarket(sellProduct.id, {size: sellSize}).pipe(
      tap((r) => {
        this.notify.open(sellProduct.id  + ' selled!');
        console.log('response sell', r);
      }),

      mergeMap((r) => {
        return this.coinbaseProService.getAccounts().pipe(
          map((accounts: any[]) => {

            const accountsFiltered = accounts.filter(
              (r: any) => r.currency === sellCurrency
            );

            if (accountsFiltered[0]) {
              return accountsFiltered[0].available;
            }

            return 0;
          })
        );
      })
    ).subscribe(
      (accountAvailable) => {

        console.log('accountPrevAvailable', accountPrevAvailable);
        console.log('accountAvailable', accountAvailable);

        let funds = accountAvailable - accountPrevAvailable;
        funds = this.utils.getFundsIncrement(buyProduct, funds);

        this.coinbaseProService.buyMarket(buyProduct.id, {funds: funds}).pipe(
          finalize(() => {
            this.loadAccounts();
            this.swapLoading = false;
          })
        ).subscribe(
          (result) => {
            this.notify.open(buyProduct.id  + ' buyed!');
            console.log('response buy', result);
          },
          error => {
            console.log(error.error.message);
            this.notify.open('Buy error: ' + error.error.message);
          });

      },
      error => {
        console.log(error.error.message);
        this.notify.open('Sell error: ' + error.error.message);
      });

  }

  sell($event: any) {

    const sellProductId = $event.sellProduct.id;
    const size = $event.size;

    this.swapLoading = true;

    this.coinbaseProService.sellMarket(sellProductId, {size: size}).pipe(
      finalize(() => {
        this.loadAccounts();
        this.swapLoading = false;
      })
    ).subscribe(
      (r) => {
        this.notify.open(sellProductId  + ' selled!');
      },
      error => {
        console.log(error.error.message);
        this.notify.open('Sell error: ' + error.error.message);
      });

  }

  buy($event: any) {

    const buyProductId = $event.buyProduct.id;
    const funds = $event.funds;

    this.swapLoading = true;

    this.coinbaseProService.buyMarket(buyProductId, {funds: funds}).pipe(
      finalize(() => {
        this.loadAccounts();
        this.swapLoading = false;
      })
    ).subscribe(
      (result) => {
        this.notify.open(buyProductId  + ' buyed!');
      },
      error => {
        console.log(error.error.message);
        this.notify.open('Buy error: ' + error.error.message);
      });
  }

/*
  loadPrices() {

    let observables: any = {};

    // per tutti gli account con soldi
    // più quelli che voglio osservare
    const accountsWithMoney = this.accounts$.getValue().filter(
      (item: any) => item.available > 0 && !['EUR','USDT'].includes(item.currency)
    ).map(
      (item: any) => item.currency + '-USDT'
    );

    const productsGraphSelected = this.getProductsGraphSelected();

    const products = [...new Set([
      ...accountsWithMoney,
      ...productsGraphSelected
    ])];

    products.forEach((productId: string) => {
      observables[productId] = this.coinbaseProService.getProductTicker(productId).pipe(
        map((result: any) => {
          return {
            symbol: productId,
            price: Number(result.price)
          };
        })
      );
    });


    forkJoin(observables).pipe(
      takeUntil(this.destroy$),
      map((result: any) => {

        let rows: any[] = [];

        const symbols = Object.keys(result);

        symbols.forEach((symbol: string) => {
          rows.push(result[symbol]);
        });

        return rows;
      })
    ).subscribe(
      result => this.prices$.next(result),
      err => this.prices$.error(err)
    );

  }
*/

  setStorage() {
    const storage: any = {
      trendObserver: this.trendObserver,
      alerts: this.alerts,
      productsGraph: this.productsGraph,
      productsTicker: this.productsTicker
    }
    localStorage.setItem('cryptoz.storage', JSON.stringify(storage));
  }
  getStorage(): any {
    const storage = localStorage.getItem('cryptoz.storage') || '{}';
    const storageValue: any = JSON.parse(storage);

    return storageValue;
  }

}
