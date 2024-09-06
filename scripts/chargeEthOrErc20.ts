import { ethers } from 'ethers'
import { ERC20__factory } from '@arbitrum/sdk/dist/lib/abi/factories/ERC20__factory'
import fs from 'fs'
import { ERC20 } from '@arbitrum/sdk/dist/lib/abi/ERC20'

// Delay function
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Read the JSON configuration
const configRaw = fs.readFileSync(
  './config/orbitSetupScriptConfig.json',
  'utf-8'
)
const config = JSON.parse(configRaw)
const ERC20InboxAddress = config.inbox

const erc20InboxInterface = new ethers.utils.Interface([
  'function depositERC20(uint256) public returns (uint256)',
])

async function main() {
  const privateKey = process.env.PRIVATE_KEY
  const L1_RPC_URL = process.env.L1_RPC_URL
  const L2_RPC_URL = process.env.L2_RPC_URL
  const amount = process.env.AMOUNT

  if (!privateKey || !L1_RPC_URL || !L2_RPC_URL || !amount) {
    throw new Error('Required environment variable not found')
  }

  const l1Provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL)
  const l2Provider = new ethers.providers.JsonRpcProvider(L2_RPC_URL)
  const l1Signer = new ethers.Wallet(privateKey).connect(l1Provider)

  const erc20Inbox = new ethers.Contract(
    ERC20InboxAddress,
    erc20InboxInterface,
    l1Signer
  )

  const configRaw = fs.readFileSync(
    './config/orbitSetupScriptConfig.json',
    'utf-8'
  )
  const config = JSON.parse(configRaw)
  const nativeToken = config.nativeToken
  const oldBalance = await l2Provider.getBalance(l1Signer.address)
  let tx
  if (nativeToken === ethers.constants.AddressZero) {
    const inboxAddress = config.inbox
    const depositEthInterface = new ethers.utils.Interface([
      'function depositEth() public payable',
    ])
    // create contract instance
    const contract = new ethers.Contract(
      inboxAddress,
      depositEthInterface,
      l1Signer
    )
    // deposit 0.4 ETH
    const tx = await contract.depositEth({
      value: ethers.utils.parseEther('0.4'),
    })
    console.log('Transaction hash on parent chain: ', tx.hash)
    await tx.wait()
    console.log('Transaction has been mined')
    console.log('0.4 ETHs are deposited to your account')
  } else {
    const nativeTokenContract = ERC20__factory.connect(nativeToken, l1Signer)
    let enoughAllowence = await getAllowence(nativeTokenContract, erc20Inbox, l1Signer);
    const owner = await l1Signer.getAddress(); // The address of the token owner (l1Signer)


    const decimals = await nativeTokenContract.decimals()
    if (decimals !== 18) {
      throw new Error('We currently only support 18 decimals token')
    }
    tx = await erc20Inbox.depositERC20(
      ethers.utils.parseUnits(amount, decimals)
    )
    console.log('Transaction hash on parent chain: ', tx.hash)
    await tx.wait()
    console.log('Transaction has been mined')
    console.log(amount + ' native tokens are deposited to your account')
  }

  while (true) {
    const newBalance = await l2Provider.getBalance(l1Signer.address)
    if (newBalance.gt(oldBalance)) {
      console.log(
        `LFG! 🚀 Balance of your account on Orbit chain increased by ${amount} Ether.`
      )
      break
    }
    console.log(
      'Balance not changed yet. Waiting for another 30 seconds to receive the funds on the Orbit chain ⏰⏰⏰⏰⏰⏰'
    )
    await delay(30 * 1000)
  }
}
async function getAllowence(nativeTokenContract: ERC20, erc20Inbox: ethers.Contract, l1Signer: ethers.Wallet) {
  const erc20InboxAddress = erc20Inbox.address; // Address of the ERC20 Inbox contract
  const spender = erc20InboxAddress; // The address that will spend the tokens
  const owner = await l1Signer.getAddress(); // The address of the token owner (l1Signer)

  // Step 1: Check the current allowance
  const currentAllowance = await nativeTokenContract.allowance(owner, spender);
  console.log(`Current allowance for ${spender}:`, currentAllowance.toString());

  // Step 2: Approve if necessary
  const requiredAllowance = ethers.constants.MaxUint256; // The amount you want to approve

  if (currentAllowance.lt(requiredAllowance)) {
    console.log('Approving native token for deposit through inbox');
    const approveTx = await nativeTokenContract.approve(
      spender,
      requiredAllowance,
    );
    const approveTxReceipt = await approveTx.wait();
    console.log(
      'Transaction hash for approval: ',
      approveTxReceipt.transactionHash
    );
  } else {
    console.log('No need to approve, sufficient allowance already set');
  }
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
