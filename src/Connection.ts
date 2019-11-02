export enum ConnectStatus {
    Close = 0,
    Active,
    Pending
}

export interface Connection {

    TAG: string;

    GetStatus(): ConnectStatus;

    Connect: (argc?: any) => Promise<boolean>;

    Close: () => void;

    on(event: "stdout", listener: (str: string) => void): this;
    
    on(event: "stderr", listener: (str: string) => void): this;

    on(event: 'connect', listener: () => void): this;

    on(event: 'close', listener: () => void): this;

    on(event: 'error', listener: (err: Error) => void): this;
}