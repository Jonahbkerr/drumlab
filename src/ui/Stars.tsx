interface Props {
  count: number;
  filled: number;
  dim?: boolean;
  size?: number;
}

export default function Stars({ count, filled, dim = false, size = 16 }: Props) {
  return (
    <span className="stars">
      {Array.from({ length: count }, (_, i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          style={{ opacity: dim && i < filled ? 0.3 : 1 }}
        >
          <path
            d="M12 2l2.9 6.2 6.8.9-5 4.7 1.3 6.7-6-3.3-6 3.3 1.3-6.7-5-4.7 6.8-.9z"
            fill={i < filled ? 'var(--warn)' : 'var(--surface-3)'}
          />
        </svg>
      ))}
    </span>
  );
}
