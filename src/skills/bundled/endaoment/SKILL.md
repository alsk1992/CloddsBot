---
name: endaoment
description: "Donate to 501(c)(3) charities onchain via Endaoment - tax-deductible crypto donations"
command: donate
emoji: "💝"
gates:
  envs:
    - PRIVATE_KEY
---

# Endaoment Charity Donations

Donate to 501(c)(3) nonprofits onchain via Endaoment smart contracts on Base.

## Contracts (Base)

| Contract | Address |
|----------|---------|
| Registry | `0x237b53bcfbd3a114b549dfec96a9856808f45c94` |
| OrgFundFactory | `0x10fd9348136dcea154f752fe0b6db45fc298a589` |
| USDC | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` |

## Commands

### Search
```
/donate search <name or EIN>     Find charity by name or EIN
/donate info <EIN>               Get charity info
```

### Donate
```
/donate <EIN> <amount>           Donate USDC to charity
/donate approve <amount>         Approve USDC for donations
```

## Popular Charities

| Charity | EIN |
|---------|-----|
| GiveDirectly | 27-1661997 |
| American Red Cross | 53-0196605 |
| Doctors Without Borders | 13-3433452 |
| ASPCA | 13-1623829 |

## Examples

```
/donate search "Red Cross"
/donate info 27-1661997
/donate 27-1661997 10              # Donate $10 USDC
```

## Fees

- Org donations: 1.5% fee (e.g., $100 → $1.50 fee, $98.50 to charity)
- All donations are tax-deductible (US 501(c)(3))

## Setup

```bash
export PRIVATE_KEY="0x..."  # Your wallet key
```

Requires USDC on Base.
