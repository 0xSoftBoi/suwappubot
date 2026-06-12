/*
 * @Description: 
 * @Version: 1.0
 * @Autor: z.cejay@gmail.com
 * @Date: 2022-09-21 12:11:14
 * @LastEditors: cejay
 * @LastEditTime: 2022-09-26 15:35:41
 */

export interface Result {
    address: string;
    blockHash: string;
    blockNumber: string;
    data: string;
    logIndex: string;
    removed: boolean;
    topics: string[];
    transactionHash: string;
    transactionIndex: string;
}

export interface FilterLogs {
    jsonrpc: string;
    id: number;
    result: Result[];
}


