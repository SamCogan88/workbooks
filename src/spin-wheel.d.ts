declare module 'spin-wheel' {
  export interface SpinWheelItem {
    label?: string
    backgroundColor?: string
    labelColor?: string
  }

  export interface SpinWheelProps {
    items?: SpinWheelItem[]
    isInteractive?: boolean
    radius?: number
    itemLabelRadius?: number
    itemLabelRadiusMax?: number
    itemLabelAlign?: 'left' | 'center' | 'right'
    itemLabelBaselineOffset?: number
    itemLabelFont?: string
    itemLabelFontSizeMax?: number
    itemLabelStrokeColor?: string
    itemLabelStrokeWidth?: number
    lineColor?: string
    lineWidth?: number
    borderColor?: string
    borderWidth?: number
    pixelRatio?: number
    pointerAngle?: number
    onRest?: () => void
  }

  export class Wheel {
    constructor(container: Element, props?: SpinWheelProps)
    items: SpinWheelItem[]
    remove(): void
    spinToItem(itemIndex?: number, duration?: number, spinToCenter?: boolean, numberOfRevolutions?: number, direction?: 1 | -1, easingFunction?: ((n: number) => number) | null): void
  }
}