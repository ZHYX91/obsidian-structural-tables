# Callout mapping

## Custom

> [!navbox]+ Custom table
> | **Google free and open-source software** | < |
> | --- | --- |
> | Software | Applications |

## Row headers

> [!navbox]+ Rich row headers
> | Name | Value |
> | --- || --- |
> | **Software** | *Applications* |

## Multiple header rows

> [!navbox]+ Grouped headers
> | **Google** | < |
> | Name | Value |
> | --- | --- |
> | Software | Applications |

## Nested

> [!note] Outer
> > [!navbox]+ Inner
> > | Google | < |
> > | --- | --- |
> > | Software | Applications |

## Mixed tables

> [!navbox] Mixed tables
> | Name | Value |
> | --- || --- |
> | **Software** | Applications |
>
> | Plain | Table |
> | --- | --- |
> | Kept | Native |
>
> | Google | < |
> | --- | --- |
> | Software | Applications |

## Identical tables

> [!navbox] Identical tables
> | Google | < |
> | --- | --- |
> | Software | Applications |
>
> | Google | < |
> | --- | --- |
> | Software | Applications |

## Indented list

- List item

  > [!navbox]+ Listed table
  > | Google | < |
  > | --- | --- |
  > | Software | Applications |

## Protected source

```md
> [!navbox] Code sample
> | Google | < |
> | --- | --- |
> | Software | Applications |
```

## Invalid row header

> [!navbox] Invalid syntax stays uneditable
> | Name || Value |
> | --- || --- |
> | Software || Applications |

End.
