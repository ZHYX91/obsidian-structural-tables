# GFM preview safety

## Row headers only

| --- || --- |
| Name | Alice |
| Age | 00123 |
| City | Paris |

## Identical table one

| Name | Value |
| --- | --- |
| Same | 00123 |

Text between the byte-identical tables.

| Name | Value |
| --- | --- |
| Same | 00123 |

## Structural table

| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- | ---: | ---: |
| North | 10 | 20 |
| ^ | 30 | 40 |

## Hidden source

| A | B |
| --- | --- |
| visible | value | KEEP HIDDEN |

## Container

- Container item

    | --- || --- |
    | Name | Alice |
    | Age | 00123 |

## Boundary

KEEP BEFORE | ordinary prose

| A | B |
| --- | --- |
| One | Two |

KEEP AFTER | ordinary prose
