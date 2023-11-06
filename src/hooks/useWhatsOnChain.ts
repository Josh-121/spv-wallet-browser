import axios from 'axios';
import { P2PKHAddress } from 'bsv-wasm-web';
import { BSV_DECIMAL_CONVERSION, WOC_BASE_URL, WOC_TESTNET_BASE_URL } from '../utils/constants';
import { NetWork } from '../utils/network';
import { storage } from '../utils/storage';
import { useNetwork } from './useNetwork';
export type UTXO = {
  satoshis: number;
  vout: number;
  txid: string;
  script: string;
};

export type WocUtxo = {
  height: number;
  tx_pos: number;
  tx_hash: string;
  value: number;
};

export type ChainInfo = {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  mediantime: number;
  verificationprogress: number;
  pruned: boolean;
  chainwork: string;
};

export const useWhatsOnChain = () => {
  const { network } = useNetwork();
  const apiKey = process.env.REACT_APP_WOC_API_KEY;
  const config =
    network === NetWork.Mainnet
      ? {
          headers: {
            'woc-api-key': apiKey,
          },
        }
      : undefined;

  const getBaseUrl = () => {
    return network === NetWork.Mainnet ? WOC_BASE_URL : WOC_TESTNET_BASE_URL;
  };

  const getBsvBalance = async (address: string, pullFresh?: boolean): Promise<number | undefined> => {
    const utxos = await getUtxos(address, pullFresh);
    if (!utxos) return 0;

    const sats = utxos.reduce((a, item) => a + item.satoshis, 0);
    const bsvTotal = sats / BSV_DECIMAL_CONVERSION;
    return bsvTotal;
  };

  const getUtxos = async (fromAddress: string, pullFresh?: boolean): Promise<UTXO[]> => {
    return new Promise((resolve) => {
      try {
        storage.get(['paymentUtxos'], async ({ paymentUtxos }) => {
          if (!pullFresh && paymentUtxos?.length > 0) {
            resolve(paymentUtxos);
            return;
          }

          const { data } = await axios.get(`${getBaseUrl()}/address/${fromAddress}/unspent`, config);
          const utxos: UTXO[] = data
            .map((utxo: WocUtxo) => {
              return {
                satoshis: utxo.value,
                vout: utxo.tx_pos,
                txid: utxo.tx_hash,
                script: P2PKHAddress.from_string(fromAddress).get_locking_script().to_asm_string(),
              } as UTXO;
            })
            .sort((a: UTXO, b: UTXO) => (a.satoshis > b.satoshis ? -1 : 1));
          storage.set({ paymentUtxos: utxos });
          resolve(utxos);
        });
      } catch (error) {
        console.log(error);
        return [];
      }
    });
  };

  const getExchangeRate = async (): Promise<number | undefined> => {
    return new Promise((resolve, reject) => {
      storage.get(['exchangeRateCache'], async ({ exchangeRateCache }) => {
        try {
          if (exchangeRateCache?.rate && Date.now() - exchangeRateCache.timestamp < 5 * 60 * 1000) {
            resolve(Number(exchangeRateCache.rate.toFixed(2)));
          } else {
            const res = await axios.get(`${getBaseUrl()}/exchangerate`, config);
            if (!res.data) {
              throw new Error('Could not fetch exchange rate from WOC!');
            }

            const rate = Number(res.data.rate.toFixed(2));
            const currentTime = Date.now();
            storage.set({ exchangeRateCache: { rate, timestamp: currentTime } });
            resolve(rate);
          }
        } catch (error) {
          console.log(error);
          reject(error);
        }
      });
    });
  };

  const getRawTxById = async (txid: string): Promise<string | undefined> => {
    try {
      const { data } = await axios.get(`${getBaseUrl()}/tx/${txid}/hex`, config);
      return data;
    } catch (error) {
      console.log(error);
    }
  };

  const broadcastRawTx = async (txhex: string): Promise<string | undefined> => {
    try {
      const { data: txid } = await axios.post(`${getBaseUrl()}/tx/raw`, { txhex }, config);
      return txid;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        // Access to config, request, and response
        console.error('broadcast rawtx failed:', error.response.data);
      } else {
        console.error('broadcast rawtx failed:', error);
      }
    }
  };

  const getSuitableUtxo = (utxos: UTXO[], minimum: number) => {
    const suitableUtxos = utxos.filter((utxo) => utxo.satoshis > minimum);

    if (suitableUtxos.length === 0) {
      throw new Error('No UTXO large enough for this transaction');
    }
    // Select a random UTXO from the suitable ones
    const randomIndex = Math.floor(Math.random() * suitableUtxos.length);
    return suitableUtxos[randomIndex];
  };

  const getInputs = (utxos: UTXO[], satsOut: number, isSendAll: boolean) => {
    if (isSendAll) return utxos;
    let sum = 0;
    let index = 0;
    let inputs: UTXO[] = [];

    while (sum <= satsOut) {
      const utxo = utxos[index];
      sum += utxo.satoshis;
      inputs.push(utxo);
      index++;
    }
    return inputs;
  };

  const getChainInfo = async (): Promise<ChainInfo | undefined> => {
    try {
      const { data } = await axios.get(`${getBaseUrl()}/chain/info`, config);
      return data as ChainInfo;
    } catch (error) {
      console.log(error);
    }
  };

  return {
    getUtxos,
    getBsvBalance,
    getExchangeRate,
    getRawTxById,
    getBaseUrl,
    broadcastRawTx,
    getSuitableUtxo,
    getInputs,
    getChainInfo,
  };
};
