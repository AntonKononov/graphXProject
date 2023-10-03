/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from "../types/schema";
import { BigDecimal, Address, log } from "@graphprotocol/graph-ts/index";
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD } from "./helpers";

const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const USDC_WETH_PAIR = "0x85528565BF1972aa1deA76c0fd23A97d917bC5d2"; // created
const DAI_WETH_PAIR = ""; // created block
const USDT_WETH_PAIR = ""; // created block

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let daiPair = Pair.load(DAI_WETH_PAIR); // dai is token0
  let usdcPair = Pair.load(USDC_WETH_PAIR); // usdc is token0
  let usdtPair = Pair.load(USDT_WETH_PAIR); // usdt is token1

  // all 3 have been created
  if (daiPair !== null && usdcPair !== null && usdtPair !== null) {
    let totalLiquidityETH = daiPair.reserve1
      .plus(usdcPair.reserve1)
      .plus(usdtPair.reserve0);
    let daiWeight = daiPair.reserve1.div(totalLiquidityETH);
    let usdcWeight = usdcPair.reserve1.div(totalLiquidityETH);
    let usdtWeight = usdtPair.reserve0.div(totalLiquidityETH);
    return daiPair.token0Price
      .times(daiWeight)
      .plus(usdcPair.token0Price.times(usdcWeight))
      .plus(usdtPair.token1Price.times(usdtWeight));
    // dai and USDC have been created
  } else if (daiPair !== null && usdcPair !== null) {
    let totalLiquidityETH = daiPair.reserve1.plus(usdcPair.reserve1);
    let daiWeight = daiPair.reserve1.div(totalLiquidityETH);
    let usdcWeight = usdcPair.reserve1.div(totalLiquidityETH);
    return daiPair.token0Price
      .times(daiWeight)
      .plus(usdcPair.token0Price.times(usdcWeight));
    // USDC is the only pair so far
  } else if (usdcPair !== null) {
    return usdcPair.token0Price;
  } else {
    return ZERO_BD;
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  "0x4200000000000000000000000000000000000006", // WETH
  // '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0xd13462dFfbB34aEC56c651534EE05dA44D8A4Cbe', // USDC
  // '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  // '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' // WBTC
];

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString("2");

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD;
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    log.info("log info", [
      token.id,
      WHITELIST[i],
    ]);
    let pairAddress = factoryContract.getPair(
      Address.fromString(token.id),
      Address.fromString(WHITELIST[i])
    );
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString());
      if (pair) {
        if (
          pair.token0 == token.id &&
          pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)
        ) {
          let token1 = Token.load(pair.token1);
          if (!token1 || !token1.derivedETH) return ZERO_BD;
          return pair.token1Price.times(token1.derivedETH as BigDecimal); // return token1 per our token * Eth per token 1
        }
        if (
          pair.token1 == token.id &&
          pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)
        ) {
          let token0 = Token.load(pair.token0);
          if (!token0 || !token0.derivedETH) return ZERO_BD;
          return pair.token0Price.times(token0.derivedETH as BigDecimal); // return token0 per our token * ETH per token 0
        }
      }
    }
  }
  return ZERO_BD; // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked fee amount based on token whitelist
 * If both are, return the difference between the token amounts
 * If not, return 0
 */
export function getTrackedFeeVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load("1");
  if (!bundle) return ZERO_BD;
  if (!token0 || !token0.derivedETH) return ZERO_BD;
  if (!token1 || !token1.derivedETH) return ZERO_BD;
  let price0 = token0.derivedETH!.times(bundle.ethPrice);
  let price1 = token1.derivedETH!.times(bundle.ethPrice);

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    let tokenAmount0USD = tokenAmount0.times(price0);
    let tokenAmount1USD = tokenAmount1.times(price1);
    if (tokenAmount0USD.ge(tokenAmount1USD)) {
      return tokenAmount0USD.minus(tokenAmount1USD);
    } else {
      return tokenAmount1USD.minus(tokenAmount0USD);
    }
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load("1");
  if (!bundle) return ZERO_BD;
  if (!token0 || !token0.derivedETH) return ZERO_BD;
  if (!token1 || !token1.derivedETH) return ZERO_BD;
  let price0 = token0.derivedETH!.times(bundle.ethPrice!);
  let price1 = token1.derivedETH!.times(bundle.ethPrice!);

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString("2"));
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0);
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1);
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load("1");
  if (!bundle) return ZERO_BD;
  if (!token0 || !token0.derivedETH) return ZERO_BD;
  if (!token1 || !token1.derivedETH) return ZERO_BD;
  let price0 = token0.derivedETH!.times(bundle.ethPrice!);
  let price1 = token1.derivedETH!.times(bundle.ethPrice!);

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString("2"));
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString("2"));
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}
