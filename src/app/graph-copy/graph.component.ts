import {AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {BehaviorSubject, forkJoin, interval, Observable, of, Subject, Subscription} from "rxjs";
import {filter, first, map, takeUntil, tap} from "rxjs/operators";
import {HttpClient} from "@angular/common/http";
import {FormBuilder, FormControl, FormGroup, Validators} from "@angular/forms";
import {MatAutocompleteSelectedEvent} from "@angular/material/autocomplete";
import {CoinbaseProService} from "../coinbase-pro.service";

declare const TradingView: any;

export interface Currency {
  symbol: string;
  price: number;
}

@Component({
  selector: 'app-graph',
  templateUrl: './graph.component.html',
  styleUrls: ['./graph.component.scss']
})
export class GraphComponent implements OnInit, OnDestroy {

  @Input() products: any;
  @Input() accounts: any;

  public colorScheme = {
    domain: [
      '#FF8A80',
      '#EA80FC',
      '#9ba9f5',
      '#4ad2b3',
      '#f8c11a',
      '#FF9E80',
      '#8e4bdb',
      '#419a2d',
      '#e77fa3',
      '#ee5945',
      '#3288c9',
    ]
  };

  private intervalSub: Subscription = new Subscription();
  private prices$: BehaviorSubject<Currency[]> = new BehaviorSubject<Currency[]>([]);
  public history: any = {};
  public historyRows: any[] = [];
  public messages: any[] = [];

  public uiForm: FormGroup = new FormGroup({});
  public controlCheckSymbol: FormControl = new FormControl(null);

  startedAt: number = 0;
  isStarted: boolean = false;
  isLoading: boolean = false;

  average: any = {};
  rate: any = {};

  chartData: any[] = [];

  @ViewChild('symbolsInput') symbolsInput: ElementRef<HTMLInputElement> | undefined;
  selectedSymbols: string[] = [];

  protected destroy$ = new Subject();

  constructor(
    private http: HttpClient,
    private fb: FormBuilder,
    private coinbaseProService: CoinbaseProService
  ) {}

  ngOnInit(): void {
    const storage = this.getStorage();
    this.selectedSymbols = storage?.selectedSymbols || [];
    const minutes = storage?.minutes || 1;
    const service = storage?.service || null;

    this.uiForm = this.fb.group({
      minutes: [minutes, Validators.required],
      service: [service, Validators.required],
      symbols: [null, Validators.required],
    });

  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setStorage() {
    const storage: any = {
      selectedSymbols: this.selectedSymbols,
      minutes: this.uiForm.get('minutes')?.value,
      service: this.uiForm.get('service')?.value
    }

    localStorage.setItem('cryptoz.form', JSON.stringify(storage));
  }
  getStorage(): any {
    const storage = localStorage.getItem('cryptoz.form') || '{}';
    const storageValue: any = JSON.parse(storage);

    return storageValue;
  }

  getChartData() {

    let chartData: any[] = [];

    this.getSymbols().forEach((symbol: string) => {

      const history = {...this.history}[symbol];
      let rate = 0;

      let item = {
        name: symbol,
        series: history.map((price: number, i: number) => {

          if(price === null) {
            return {
              name: i.toString(),
              value: 0,
              price: null
            }
          }

          return {
            name: i.toString(),
            value: this.diff(price, history[0]),
            price: price
          }
        })
      }

      chartData.push(item);

    });

    return chartData;
  }

  clear() {
    console.log('clear');
    this.startedAt = 0;
    this.history = [];
    this.historyRows = [];
    this.chartData = [];
  }

  stop() {
    console.log('stop');
    this.isStarted = false;
    this.uiForm.get('minutes')?.enable();
    this.intervalSub.unsubscribe();
    this.ngOnDestroy();
  }

  start() {
    if (!this.getSelectedManagedSymbols().length) {
      return;
    }

    this.setStorage();

    console.log('start');
    this.isStarted = true;

    if (!this.startedAt) {
      this.startedAt = Date.now();
    }

    this.check();
    // this.loadWidgets();

    const milliseconds = this.uiForm.value.minutes * 60 * 1000;
    this.uiForm.get('minutes')?.disable();

    this.loadPrices();
    this.intervalSub = interval(milliseconds).subscribe((x: number) => {
      // console.log('Load prices:', x);
      if (!this.startedAt) {
        this.startedAt = Date.now();
      }
      this.loadPrices();
    });
  }

  check() {
    // controllo i prezzi del momento e li salvo
    this.prices$.pipe(
      takeUntil(this.destroy$),
      filter((result: any) => result.length)
    ).subscribe((result: any) => {

      result.forEach((currency: any) => {

        if (this.isCheckingSymbol(currency.symbol)) {
          const lastCurrencyPrice = this.getLast(currency.symbol);

          if (!lastCurrencyPrice) return;

          if (currency.price < lastCurrencyPrice) {
            // se il nuovo prezzo è più basso di X

            // trovo la moneta che ha avuto il rialzo maggiore
            const suggestSymbol = this.findHigherRise();
            if (suggestSymbol) {
              // invio il messaggio
              this.message(`Cambia ${currency.symbol} con ${suggestSymbol}`);
            }
          }
        }


      });


      this.addHistory(result);

      this.calculateData();
    });

  }

  calculateData() {
    this.getSymbols().forEach((symbol: string) => {
      this.average[symbol] = this.getAverage(symbol);
      this.rate[symbol] = this.getRate(symbol);
    });

    this.chartData = this.getChartData();
  }

  isCheckingSymbol(symbol: string) {
    return this.controlCheckSymbol.value === symbol;
  }

  message(message: string) {
    //alert(message);
    this.messages.unshift({
      date: Date.now(),
      message: message
    });
    this.messages.slice(0,4);
  }

  getAverage(symbol: string) {
    let history = {...this.history}[symbol].reverse();
    let sum = 0;

    if (!history.length) return 0;

    history.forEach((item: number, i: number) => {
      sum = sum + item;
    });

    let fixed = history[0].toString().split('.');
    fixed = fixed[1] ? fixed[1].length : 0;

    const average = (sum / history.length).toFixed(fixed);

    return average;
  }

  getRate(symbol: string) {
    let history = {...this.history}[symbol].reverse();

    const last = history[0];
    const first = history[history.length - 1];

    return this.diff(first, last);
  }

  diff(from: number, to: number) {
    if (!to) {
      to = from;
    }
    return (((from - to) / from) * 100).toFixed(2);
  }

  /**
   * Ritorna la moneta che ha avuto il maggiore rialzo
   */
  findHigherRise(): string | null {
    const symbols = this.getSymbols();

    let topSymbol: string = '';
    let topSymbolScore: number = 0;

    let higher: any = {};

    symbols.forEach((symbol: string) => {

      higher[symbol] = 0;

      let history = {...this.history}[symbol].reverse();

      history.forEach((item: number, i: number) => {
        if (history[i+1]) {
          if (item > history[i+1]) {
            higher[symbol]++;
          }
          if (item < history[i+1]) {
            higher[symbol]--;
          }
        }

      });


      if (higher[symbol] > topSymbolScore) {
        topSymbolScore = {...higher[symbol]};
        topSymbol = symbol;
      }

    });

    console.log(higher);

    console.log(topSymbol);

    return topSymbol || null;
  }

  getLast(symbol: string): any {
    return this.history[symbol] ? this.history[symbol].reverse()[0] : null;
  }

  loadPricesFromCoinbasePro(symbols: string[]): Observable<any> {

    let observables: any = {};

    symbols.forEach((symbol: string) => {
      observables[symbol] = this.http.get(`http://localhost:3000/coinbase/products/${symbol}/ticker`).pipe(
        map((result: any) => {
          return {
            symbol: symbol,
            price: Number(result.price)
          };
        })
      );
    });


    return forkJoin(observables).pipe(
      takeUntil(this.destroy$),
      map((result: any) => {

        let rows: any[] = [];

        const symbols = Object.keys(result);

        symbols.forEach((symbol: string) => {
          rows.push(result[symbol]);
        });

        return rows;
      })
    );

  }

  loadPricesFromCoinbase(symbols: string[]): Observable<any> {

    let observables: any = {};

    symbols.forEach((symbol: string) => {
      observables[symbol] = this.http.get(`https://api.coinbase.com/v2/prices/${symbol}/spot`).pipe(
        map((result: any) => {
          return {
            symbol: symbol,
            price: Number(result.data.amount)
          };
        })
      );
    });

    return forkJoin(observables).pipe(
      takeUntil(this.destroy$),
      map((result: any) => {

        let rows: any[] = [];

        const symbols = Object.keys(result);

        symbols.forEach((symbol: string) => {
          rows.push(result[symbol]);
        });

        return rows;
      })
    );

  }

  loadPrices(): void {

    const symbols: string[] = this.getSelectedManagedSymbols();



    if (!symbols.length) {
      return;
    }

    this.isLoading = true;
    const service = this.uiForm.get('service')?.value.toLowerCase();

    let serviceCall: Observable<any>;

    switch(service) {
      case 'coinbasepro':
        serviceCall = this.loadPricesFromCoinbasePro(symbols);
        break;
      case 'coinbase':
      default:
        serviceCall = this.loadPricesFromCoinbase(symbols);
        break;
    }
    serviceCall.subscribe((result) => {
      this.prices$.next(result);
      this.isLoading = false;
    });

  }

  selectedManagedSymbol(event: MatAutocompleteSelectedEvent): void {
    this.selectedSymbols.push(event.option.viewValue);
    if (this.symbolsInput) {
      this.symbolsInput.nativeElement.value = '';
      this.uiForm.get('symbols')?.patchValue(null);
    }

    this.setStorage();
  }

  getSelectedManagedSymbols() {
    // unique vals
    return [...new Set(this.selectedSymbols)];
  }

  removeSelectedManagedSymbols(symbol: string): void {
    const index = this.selectedSymbols.indexOf(symbol);

    if (index >= 0) {
      this.selectedSymbols.splice(index, 1);
    }

    delete this.history[symbol];
    this.historyRows = this.historyRows.map((item) => {
      delete item[symbol];
      return item;
    });

    this.chartData = this.chartData.filter((item) => {
      return item.name !== symbol;
    });

    this.setStorage();
  }

  getManagedSymbols(): any[] {
    return this.products.filter((item: any) => {
      return !this.getSelectedManagedSymbols().includes(item.id);
    });
  }

  getSymbols(): string[] {
    return this.history ? Object.keys(this.history) : [];
  }

  addHistory(result: any[]) {

    result.forEach((item: any) => {
      if (!this.history[item.symbol]) {
        this.history[item.symbol] = new Array(this.historyRows.length).fill(item.price);
      }
      this.history[item.symbol].push(item.price);
    });

    this.addHistoryRows(result);
  }

  addHistoryRows(result: any[]) {

    const row: any = {};
    result.forEach((item: any) => {
      row[item.symbol] = item.price;
    });

    this.historyRows.unshift(row);
  }

  getPriceColor(price: number, next: number) {

    if (price > next) {
      return 'green';
    } else if (price < next) {
      return 'red';
    }

    return 'grey';
  }

  loadWidgets() {

    const widget = `
      <!-- TradingView Widget BEGIN -->
      <div class="tradingview-widget-container">
        <div class="tradingview-widget-container__widget"></div>
        <div class="tradingview-widget-copyright"><a href="https://in.tradingview.com/symbols/NASDAQ-AAPL/technicals/" rel="noopener" target="_blank"><span class="blue-text">Technical Analysis for AAPL</span></a> by TradingView</div>
      </div>
      <!-- TradingView Widget END -->
      `;

    setTimeout(() => {

      const el = document.getElementById('technical-analysis');


      if (el) {

        this.getSymbols().forEach(symbol => {

          console.log(symbol);
          const elementWidget = document.createElement('div');
          elementWidget.style.width = (100 / (this.getSymbols().length / 2)) + '%';
          elementWidget.style.height = '340px';
          elementWidget.innerHTML = widget;

          const script = document.createElement('script');
          script.type = 'text/javascript';
          script.async = true;
          script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';
          script.innerHTML = `{
            "interval": "1m",
            "width": "100%",
            "isTransparent": true,
            "height": "100%",
            "symbol": "COINBASE:${symbol}EUR",
            "showIntervalTabs": true,
            "locale": "in",
            "colorTheme": "light"
          }`;

          elementWidget.getElementsByClassName('tradingview-widget-container')[0].appendChild(script);
          el.appendChild(elementWidget);
        });

      }

    }, 1000);
  }

}