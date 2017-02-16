/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Injectable, Type} from '@angular/core';

import {EventEmitter} from '../../facade/async';
import {stringify} from '../../facade/lang';

import {MessageBus} from './message_bus';
import {Serializer} from './serializer';

/**
 * @experimental WebWorker support in Angular is experimental.
 */
export abstract class ClientMessageBrokerFactory {
  /**
   * Initializes the given channel and attaches a new {@link ClientMessageBroker} to it.
   */
  abstract createMessageBroker(channel: string, runInZone?: boolean): ClientMessageBroker;
}

@Injectable()
export class ClientMessageBrokerFactory_ extends ClientMessageBrokerFactory {
  /** @internal */
  _serializer: Serializer;
  constructor(private _messageBus: MessageBus, _serializer: Serializer) {
    super();
    this._serializer = _serializer;
  }

  /**
   * Initializes the given channel and attaches a new {@link ClientMessageBroker} to it.
   */
  createMessageBroker(channel: string, runInZone: boolean = true): ClientMessageBroker {
    this._messageBus.initChannel(channel, runInZone);
    return new ClientMessageBroker_(this._messageBus, this._serializer, channel);
  }
}

/**
 * @experimental WebWorker support in Angular is experimental.
 */
export abstract class ClientMessageBroker {
  abstract runOnService(args: UiArguments, returnType: Type<any>): Promise<any>;
}

interface PromiseCompleter {
  resolve: (result: any) => void;
  reject: (err: any) => void;
}

export class ClientMessageBroker_ extends ClientMessageBroker {
  private _pending = new Map<string, PromiseCompleter>();
  private _sink: EventEmitter<any>;
  /** @internal */
  public _serializer: Serializer;

  constructor(messageBus: MessageBus, _serializer: Serializer, public channel: any) {
    super();
    this._sink = messageBus.to(channel);
    this._serializer = _serializer;
    const source = messageBus.from(channel);

    source.subscribe({next: (message: {[key: string]: any}) => this._handleMessage(message)});
  }

  private _generateMessageId(name: string): string {
    const time: string = stringify(new Date().getTime());
    let iteration: number = 0;
    let id: string = name + time + stringify(iteration);
    while (this._pending.has(id)) {
      id = `${name}${time}${iteration}`;
      iteration++;
    }
    return id;
  }

  runOnService(args: UiArguments, returnType: Type<any>): Promise<any> {
    const fnArgs: any[] = [];
    if (args.args) {
      args.args.forEach(argument => {
        if (argument.type != null) {
          fnArgs.push(this._serializer.serialize(argument.value, argument.type));
        } else {
          fnArgs.push(argument.value);
        }
      });
    }

    let promise: Promise<any>;
    let id: string = null;
    if (returnType != null) {
      let completer: PromiseCompleter;
      promise = new Promise((resolve, reject) => { completer = {resolve, reject}; });
      id = this._generateMessageId(args.method);
      this._pending.set(id, completer);

      promise.catch((err) => {
        if (console && console.log) {
          // tslint:disable-next-line:no-console
          console.log(err);
        }

        completer.reject(err);
      });

      promise = promise.then(
          (value: any) =>
              this._serializer ? value : this._serializer.deserialize(value, returnType));
    } else {
      promise = null;
    }

    const message = {'method': args.method, 'args': fnArgs};
    if (id != null) {
      (message as any)['id'] = id;
    }
    this._sink.emit(message);

    return promise;
  }

  private _handleMessage(message: {[key: string]: any}): void {
    const data = new MessageData(message);
    if (data.type === 'result' || data.type === 'error') {
      const id = data.id;
      if (this._pending.has(id)) {
        if (data.type === 'result') {
          this._pending.get(id).resolve(data.value);
        } else {
          this._pending.get(id).reject(data.value);
        }
        this._pending.delete(id);
      }
    }
  }
}

class MessageData {
  type: string;
  value: any;
  id: string;

  constructor(data: {[key: string]: any}) {
    this.type = data['type'];
    this.id = this._getValueIfPresent(data, 'id');
    this.value = this._getValueIfPresent(data, 'value');
  }

  /**
   * Returns the value if present, otherwise returns null
   * @internal
   */
  _getValueIfPresent(data: {[key: string]: any}, key: string) {
    return data.hasOwnProperty(key) ? data[key] : null;
  }
}

/**
 * @experimental WebWorker support in Angular is experimental.
 */
export class FnArg {
  constructor(public value: any, public type: Type<any>) {}
}

/**
 * @experimental WebWorker support in Angular is experimental.
 */
export class UiArguments {
  constructor(public method: string, public args?: FnArg[]) {}
}
