import { AriaRole } from 'react';
import { ButtonHTMLAttributes } from 'react';
import { CSSProperties } from 'react';
import { ElementType } from 'react';
import { HTMLAttributes } from 'react';
import { InputHTMLAttributes } from 'react';
import { JSX } from 'react';
import { MouseEventHandler } from 'react';
import { ReactElement } from 'react';
import { ReactNode } from 'react';
import { ReactPortal } from 'react';
import { Ref } from 'react';
import { SVGAttributes } from 'react';
import { TextareaHTMLAttributes } from 'react';

export declare function Alert({ type, variant, title, description, children, icon, actionLabel, onAction, onClose, slot, className, role, ...rest }: AlertProps): JSX.Element;

export declare type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
    type?: AlertType;
    variant?: AlertVariant;
    title?: ReactNode;
    description?: ReactNode;
    icon?: ReactNode | false;
    actionLabel?: ReactNode;
    onAction?: () => void;
    onClose?: () => void;
    slot?: ReactNode;
    role?: AriaRole;
};

export declare type AlertType = 'primary' | 'secondary' | 'success' | 'error' | 'warning';

export declare type AlertVariant = 'tonal' | 'outlined';

export declare function Autocomplete({ label, labelIcon, labelAction, helperText, error, size, variant, color, startIcon, fullWidth, className, id, disabled, readOnly, value: valueProp, defaultValue, inputValue: inputValueProp, defaultInputValue, placeholder, options, onChange, onInputChange, freeSolo, name, menuFooter, clearable, }: AutocompleteProps): JSX.Element;

export declare type AutocompleteProps = Omit<TextFieldShellProps, 'endIcon'> & {
    value?: string;
    defaultValue?: string;
    inputValue?: string;
    defaultInputValue?: string;
    placeholder?: string;
    options: TextFieldOption[];
    onChange?: (value: string) => void;
    onInputChange?: (inputValue: string) => void;
    freeSolo?: boolean;
    name?: string;
    menuFooter?: ReactNode;
    clearable?: boolean;
};

export declare function Avatar({ size, variant, color, src, alt, initials, icon, className, onClick, ...rest }: AvatarProps): JSX.Element;

export declare type AvatarColor = 'primary' | 'secondary' | 'success' | 'error' | 'warning';

export declare type AvatarProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'color'> & {
    size?: AvatarSize;
    variant?: AvatarVariant;
    color?: AvatarColor;
    /** Photo URL — when set, renders image avatar (object-fit: cover). */
    src?: string;
    alt?: string;
    /** Initials for text avatar; falls back to icon when omitted. */
    initials?: string;
    icon?: ReactNode | false;
};

export declare type AvatarSize = 'sm' | 'md';

export declare type AvatarVariant = 'contained' | 'tonal';

export declare function Badge({ content, variant, color, overlap, showZero, max, status, statusColor, children, className, ...rest }: BadgeProps): JSX.Element;

export declare type BadgeColor = 'primary' | 'secondary' | 'error' | 'success' | 'warning' | 'neutral';

export declare function BadgeIndicator({ variant, color, children, className, ...rest }: BadgeIndicatorProps): JSX.Element;

export declare type BadgeIndicatorProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
    variant?: BadgeVariant;
    color?: BadgeColor;
    children?: ReactNode;
};

export declare type BadgeOverlap = 'circular' | 'rectangular';

export declare type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'content'> & {
    /** Badge label or counter. `false` hides the badge. */
    content?: ReactNode | false;
    variant?: BadgeVariant;
    color?: BadgeColor;
    overlap?: BadgeOverlap;
    showZero?: boolean;
    max?: number;
    /** Status indicator at bottom-right; `true` — check icon; `false` hides. */
    status?: ReactNode | boolean;
    statusColor?: BadgeColor;
    children?: ReactNode;
};

export declare type BadgeVariant = 'text' | 'dot';

export declare function BreadcrumbItem({ href, onClick, current, children, className, ...rest }: BreadcrumbItemProps): JSX.Element;

export declare type BreadcrumbItemData = {
    label: ReactNode;
    href?: string;
    onClick?: () => void;
    current?: boolean;
};

export declare type BreadcrumbItemProps = Omit<HTMLAttributes<HTMLLIElement>, 'children'> & {
    href?: string;
    onClick?: () => void;
    current?: boolean;
    children?: ReactNode;
};

export declare function Breadcrumbs({ items, children, separator, className, 'aria-label': ariaLabel, ...rest }: BreadcrumbsProps): JSX.Element;

export declare type BreadcrumbsProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
    items?: BreadcrumbItemData[];
    children?: ReactNode;
    separator?: ReactNode;
    'aria-label'?: string;
};

export declare function Button({ variant, color, size, loading, loadingPosition, startIcon, endIcon, className, children, disabled, type, ...rest }: ButtonProps): JSX.Element;

export declare type ButtonColor = 'primary' | 'secondary' | 'neutral' | 'success' | 'warning' | 'error';

export declare function ButtonGroup({ options, value, onChange, variant, color, size, className, 'aria-label': ariaLabel, }: ButtonGroupProps): JSX.Element;

export declare type ButtonGroupOption = {
    value: string;
    label: ReactNode;
    ariaLabel?: string;
};

export declare type ButtonGroupProps = {
    options: ButtonGroupOption[];
    value: string;
    onChange: (value: string) => void;
    /** All segments share the same variant (Figma default: contained). */
    variant?: ButtonGroupVariant;
    color?: Extract<ButtonColor, 'primary' | 'secondary' | 'neutral'>;
    size?: Exclude<ButtonSize, 'xsm'>;
    className?: string;
    'aria-label'?: string;
};

export declare type ButtonGroupVariant = Extract<ButtonVariant, 'contained' | 'tonal' | 'outlined'>;

export declare type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
    variant?: ButtonVariant;
    color?: ButtonColor;
    size?: Exclude<ButtonSize, 'xsm'>;
    loading?: boolean;
    loadingPosition?: LoadingPosition;
    startIcon?: ReactNode;
    endIcon?: ReactNode;
    children?: ReactNode;
};

export declare type ButtonSize = 'xsm' | 'sm' | 'md' | 'lg' | 'xlg';

export declare type ButtonVariant = 'contained' | 'tonal' | 'outlined' | 'text';

export declare function Checkbox({ label, size, indeterminate, className, id, disabled, ...rest }: CheckboxProps): JSX.Element;

export declare type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type' | 'children'> & {
    label?: ReactNode;
    size?: SelectionSize;
    indeterminate?: boolean;
};

export declare function Chip({ size, variant, color, shape, label, children, startIcon, onClose, onClick, className, disabled, ...rest }: ChipProps): JSX.Element;

export declare type ChipColor = 'primary' | 'neutral' | 'success' | 'error';

export declare type ChipProps = Omit<HTMLAttributes<HTMLElement>, 'color' | 'children'> & {
    size?: ChipSize;
    variant?: ChipVariant;
    color?: ChipColor;
    shape?: ChipShape;
    label?: ReactNode;
    children?: ReactNode;
    startIcon?: ReactNode | false;
    onClose?: () => void;
    disabled?: boolean;
    onClick?: MouseEventHandler<HTMLElement>;
};

export declare type ChipShape = 'rounded' | 'square';

export declare type ChipSize = 'xsm' | 'sm' | 'md';

export declare type ChipVariant = 'contained' | 'outlined' | 'text' | 'tonal';

export declare function DatePicker({ label, labelIcon, labelAction, helperText, error, size, variant, color, fullWidth, className, id, disabled, readOnly, value: valueProp, defaultValue, placeholder, onChange, name, clearable, }: DatePickerProps): JSX.Element;

export declare type DatePickerProps = Omit<TextFieldShellProps, 'endIcon' | 'startIcon'> & {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    onChange?: (value: string) => void;
    name?: string;
    clearable?: boolean;
};

export declare function Dialog({ open, onClose, width, title, subtitle, icon, children, textButtonLabel, onTextButton, secondaryButtonLabel, onSecondaryButton, mainButtonLabel, onMainButton, mainButtonStartIcon, closeOnEscape, closeOnOverlayClick, className, ...rest }: DialogProps): ReactPortal | null;

export declare type DialogProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
    open: boolean;
    onClose?: () => void;
    width?: DialogWidth;
    title?: ReactNode;
    subtitle?: ReactNode;
    /** Default header icon; pass `false` to hide. */
    icon?: ReactNode | false;
    children?: ReactNode;
    textButtonLabel?: ReactNode;
    onTextButton?: () => void;
    secondaryButtonLabel?: ReactNode;
    onSecondaryButton?: () => void;
    mainButtonLabel?: ReactNode;
    onMainButton?: () => void;
    mainButtonStartIcon?: ReactNode;
    closeOnEscape?: boolean;
    closeOnOverlayClick?: boolean;
};

export declare type DialogWidth = 'sm' | 'md' | 'lg' | 'xlg' | 'full';

export declare function EmptyState({ title, description, icon, action, children, className, ...rest }: EmptyStateProps): JSX.Element;

export declare type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
    title?: ReactNode;
    description?: ReactNode;
    icon?: ReactNode | false;
    action?: ReactNode;
    children?: ReactNode;
};

/** Sync with package.json "version" on each release — see docs/internal/release-process.md */
export declare const IC_KIT_VERSION = "0.1.0";

export declare function Icon({ path, weight, size, title, className, style, }: IconProps): JSX.Element | null;

declare const ICON_WEIGHTS: readonly ["regular", "bold", "fill"];

export declare function IconButton({ variant, color, size, loading, icon, className, disabled, type, ...rest }: IconButtonProps): JSX.Element;

export declare type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'children'> & {
    variant?: ButtonVariant;
    color?: ButtonColor;
    size?: ButtonSize;
    loading?: boolean;
    icon: ReactNode;
    'aria-label': string;
};

declare type IconPath = string;

export declare interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, 'name'> {
    /** Figma path, e.g. `Arrows & Directions/ArrowArcLeft` */
    path: IconPath;
    weight?: IconWeight;
    size?: number;
    title?: string;
    className?: string;
    style?: CSSProperties;
}

declare type IconWeight = (typeof ICON_WEIGHTS)[number];

export declare function Input({ label, labelIcon, labelAction, helperText, error, size, variant, color, startIcon, endIcon, fullWidth, className, id, disabled, readOnly, ...rest }: InputProps): JSX.Element;

export declare type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'color'> & TextFieldShellProps;

export declare type LoadingPosition = 'left' | 'right' | 'center';

export declare function MultiSelect({ label, labelIcon, labelAction, helperText, error, size, variant, color, fullWidth, className, id, disabled, readOnly, value: valueProp, defaultValue, placeholder, options, onChange, name, menuFooter, clearable, maxVisibleTags, }: MultiSelectProps): JSX.Element;

export declare type MultiSelectProps = Omit<TextFieldShellProps, 'endIcon' | 'startIcon'> & {
    value?: string[];
    defaultValue?: string[];
    placeholder?: string;
    options: TextFieldOption[];
    onChange?: (value: string[]) => void;
    name?: string;
    menuFooter?: ReactNode;
    clearable?: boolean;
    /** Сколько чипов показывать до счётчика «+N». По макету — 1. */
    maxVisibleTags?: number;
};

export declare function Pagination({ page, count, onChange, siblingCount, boundaryCount, disabled, showFirstButton, showLastButton, className, 'aria-label': ariaLabel, ...rest }: PaginationProps): JSX.Element;

export declare type PaginationProps = Omit<HTMLAttributes<HTMLElement>, 'onChange'> & {
    /** 1-based current page. */
    page: number;
    count: number;
    onChange?: (page: number) => void;
    siblingCount?: number;
    boundaryCount?: number;
    disabled?: boolean;
    showFirstButton?: boolean;
    showLastButton?: boolean;
    'aria-label'?: string;
};

export declare function Progress({ value, max, size, color, className, 'aria-label': ariaLabel, ...rest }: ProgressProps): JSX.Element;

export declare type ProgressColor = 'primary' | 'secondary' | 'neutral' | 'inherit';

export declare type ProgressProps = Omit<HTMLAttributes<HTMLProgressElement>, 'value'> & SharedProps;

export declare type ProgressSize = 'xsm' | 'sm' | 'md' | 'lg';

export declare function Radio({ label, size, className, id, disabled, ...rest }: RadioProps): JSX.Element;

export declare function RadioGroup({ name, value, defaultValue, onChange, options, size, legend, direction, className, disabled, }: RadioGroupProps): JSX.Element;

export declare type RadioGroupOption = {
    value: string;
    label: ReactNode;
    disabled?: boolean;
};

export declare type RadioGroupProps = {
    name: string;
    value?: string;
    defaultValue?: string;
    onChange?: (value: string) => void;
    options: RadioGroupOption[];
    size?: SelectionSize;
    legend?: ReactNode;
    direction?: 'column' | 'row';
    className?: string;
    disabled?: boolean;
};

export declare type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type' | 'children'> & {
    label?: ReactNode;
    size?: SelectionSize;
};

export declare function Select({ label, labelIcon, labelAction, helperText, error, size, variant, color, startIcon, fullWidth, className, id, disabled, readOnly, value: valueProp, defaultValue, placeholder, options, onChange, name, menuFooter, }: SelectProps): JSX.Element;

export declare type SelectionSize = 'sm' | 'md' | 'lg';

export declare type SelectProps = Omit<TextFieldShellProps, 'endIcon'> & {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    options: TextFieldOption[];
    onChange?: (value: string) => void;
    name?: string;
    menuFooter?: ReactNode;
};

declare type SharedProps = {
    /** 0–100. Omit for indeterminate linear bar. */
    value?: number;
    max?: number;
    size?: ProgressSize;
    color?: ProgressColor;
    'aria-label'?: string;
};

export declare function Skeleton({ variant, width, height, animation, className, style, 'aria-hidden': ariaHidden, ...rest }: SkeletonProps): JSX.Element;

export declare type SkeletonAnimation = 'pulse' | 'none';

export declare type SkeletonProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
    variant?: SkeletonVariant;
    width?: number | string;
    height?: number | string;
    animation?: SkeletonAnimation;
};

export declare type SkeletonVariant = 'text' | 'rectangular' | 'circular';

export declare function Slider({ type, min, max, step, value: valueProp, defaultValue, onChange, disabled, showValueLabel, name, id, 'aria-label': ariaLabel, className, }: SliderProps): JSX.Element;

export declare type SliderProps = {
    type?: SliderType;
    min?: number;
    max?: number;
    step?: number;
    value?: SliderValue;
    defaultValue?: SliderValue;
    onChange?: (value: SliderValue) => void;
    disabled?: boolean;
    /** Подписи значений под ползунками (Figma: hasCounter). */
    showValueLabel?: boolean;
    name?: string;
    id?: string;
    'aria-label'?: string;
    className?: string;
};

export declare type SliderType = 'continuous' | 'range';

export declare type SliderValue = number | [number, number];

export declare function Snackbar({ color, orientation, showActions, message, icon, actionLabel, onAction, onClose, children, className, role, ...rest }: SnackbarProps): JSX.Element;

export declare type SnackbarColor = 'light' | 'dark';

export declare type SnackbarOrientation = 'horizontal' | 'vertical';

export declare type SnackbarProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    color?: SnackbarColor;
    orientation?: SnackbarOrientation;
    /** Figma `end` — показывать кнопки действия. */
    showActions?: boolean;
    message: ReactNode;
    icon?: ReactNode | false;
    actionLabel?: ReactNode;
    onAction?: () => void;
    onClose?: () => void;
    children?: ReactNode;
    role?: 'status' | 'alert';
};

export declare function Spinner({ size, color, className, 'aria-label': ariaLabel, ...rest }: SpinnerProps): JSX.Element;

export declare type SpinnerProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
    size?: ProgressSize;
    color?: ProgressColor;
    'aria-label'?: string;
};

export declare function SplitButton({ label, variant, color, size, startIcon, disabled, onActionClick, onMenuClick, menuIcon, menuAriaLabel, className, ...rest }: SplitButtonProps): JSX.Element;

export declare type SplitButtonProps = Omit<ButtonHTMLAttributes<HTMLDivElement>, 'color'> & {
    label: ReactNode;
    variant?: SplitVariant;
    color?: ButtonColor;
    size?: Exclude<ButtonSize, 'xsm' | 'xlg'>;
    startIcon?: ReactNode;
    disabled?: boolean;
    onActionClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
    onMenuClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
    menuIcon?: ReactNode;
    menuAriaLabel?: string;
};

declare type SplitVariant = Extract<ButtonVariant, 'contained' | 'outlined' | 'tonal'>;

export declare function Switch({ label, size, color, className, id, disabled, checked, defaultChecked, ...rest }: SwitchProps): JSX.Element;

export declare type SwitchColor = 'primary' | 'success';

export declare type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type' | 'children'> & {
    label?: ReactNode;
    size?: SwitchSize;
    color?: SwitchColor;
};

export declare type SwitchSize = 'sm' | 'md' | 'lg';

export declare function Tab({ label, subLabel, icon, selected, variant, orientation, size, className, disabled, ...rest }: TabProps): JSX.Element;

export declare type TabItem = {
    value: string;
    label: ReactNode;
    subLabel?: ReactNode;
    icon?: ReactNode;
    disabled?: boolean;
    panel?: ReactNode;
};

export declare type TabOrientation = 'horizontal' | 'vertical';

export declare type TabProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> & {
    label: ReactNode;
    subLabel?: ReactNode;
    icon?: ReactNode;
    selected?: boolean;
    variant?: TabVariant;
    orientation?: TabOrientation;
    size?: TabSize;
};

export declare function Tabs({ items, value, onChange, variant, orientation, size, className, 'aria-label': ariaLabel, }: TabsProps): JSX.Element;

export declare type TabSize = 'sm' | 'md' | 'lg' | 'xlg';

export declare type TabsProps = {
    items: TabItem[];
    value: string;
    onChange: (value: string) => void;
    variant?: TabVariant;
    orientation?: TabOrientation;
    size?: TabSize;
    className?: string;
    'aria-label'?: string;
};

export declare type TabVariant = 'text' | 'filled';

declare function Text_2<T extends ElementType = 'span'>({ as, variant, color, className, children, ...rest }: TextProps<T>): JSX.Element;
export { Text_2 as Text }

export declare function TextArea({ label, labelIcon, labelAction, helperText, error, size, variant, color, startIcon, endIcon, fullWidth, className, id, disabled, readOnly, resizable, rows, ...rest }: TextAreaProps): JSX.Element;

export declare type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size' | 'color'> & TextFieldShellProps & {
    resizable?: boolean;
};

export declare type TextColor = 'primary' | 'secondary' | 'disabled' | 'inverse' | 'inherit';

export declare type TextFieldColor = 'primary' | 'info';

export declare function TextFieldControl({ size, variant, color, error, disabled, readOnly, multiline, startIcon, endIcon, endAction, focused, className, children, }: TextFieldControlProps): JSX.Element;

export declare type TextFieldControlProps = {
    size?: TextFieldSize;
    variant?: TextFieldVariant;
    color?: TextFieldColor;
    error?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    multiline?: boolean;
    startIcon?: ReactNode;
    endIcon?: ReactNode;
    endAction?: ReactNode;
    focused?: boolean;
    className?: string;
    children: ReactNode;
};

export declare type TextFieldOption = {
    value: string;
    label: string;
    disabled?: boolean;
};

export declare function TextFieldRoot({ label, labelIcon, labelAction, helperText, error, fullWidth, className, id, children, controlRef, }: TextFieldRootProps): JSX.Element;

export declare type TextFieldRootProps = TextFieldShellProps & {
    children: ReactNode;
    controlRef?: Ref<HTMLDivElement>;
};

export declare type TextFieldShellProps = {
    label?: ReactNode;
    labelIcon?: ReactNode;
    labelAction?: ReactNode;
    helperText?: ReactNode;
    error?: boolean;
    size?: TextFieldSize;
    variant?: TextFieldVariant;
    color?: TextFieldColor;
    startIcon?: ReactNode;
    endIcon?: ReactNode;
    fullWidth?: boolean;
    className?: string;
    id?: string;
    disabled?: boolean;
    readOnly?: boolean;
};

export declare type TextFieldSize = 'sm' | 'md' | 'lg';

export declare type TextFieldVariant = 'outlined' | 'filled' | 'text';

export declare type TextProps<T extends ElementType = 'span'> = {
    as?: T;
    variant?: TypographyVariant;
    color?: TextColor;
    children?: ReactNode;
    className?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'color'>;

export declare function Tips({ color, title, text, open: openProp, defaultOpen, onOpenChange, icon, onClose, className, ...rest }: TipsProps): JSX.Element;

export declare type TipsColor = 'error' | 'warning' | 'neutral';

export declare type TipsProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
    color?: TipsColor;
    title: ReactNode;
    text?: ReactNode;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    icon?: ReactNode | false;
    onClose?: () => void;
};

export declare function ToggleButton({ color, size, selected, icon, className, disabled, type, ...rest }: ToggleButtonProps): JSX.Element;

export declare type ToggleButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
    color?: Extract<ButtonColor, 'primary' | 'neutral'>;
    size?: Exclude<ButtonSize, 'xsm'>;
    selected?: boolean;
    icon: ReactNode;
    'aria-label': string;
};

export declare function Tooltip({ content, children, position, alignment, open: openProp, defaultOpen, onOpenChange, showDelay, hideDelay, disabled, className, ...rest }: TooltipProps): JSX.Element;

export declare type TooltipPointerAlignment = 'start' | 'middle' | 'end';

export declare type TooltipPointerPosition = 'top' | 'bottom' | 'left' | 'right';

export declare type TooltipProps = Omit<HTMLAttributes<HTMLSpanElement>, 'content'> & {
    /** Tooltip body — string or custom block. */
    content: ReactNode;
    children: ReactElement;
    position?: TooltipPointerPosition;
    alignment?: TooltipPointerAlignment;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Delay before show on hover/focus, ms. */
    showDelay?: number;
    /** Delay before hide, ms. */
    hideDelay?: number;
    disabled?: boolean;
};

declare type TypographyStyleSpec = {
    name: string;
    slug: string;
    sizePx: number;
    linePx: number;
    weight: TypographyWeight;
    trackingVar?: string;
    mono?: boolean;
};

export declare type TypographyVariant = TypographyStyleSpec['slug'];

declare type TypographyWeight = 'regular' | 'bold';

export { }
