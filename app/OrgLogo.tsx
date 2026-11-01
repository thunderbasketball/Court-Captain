// An organization's logo, or a letter badge in its color when it hasn't uploaded one. Works on server and client.
export default function OrgLogo({
  src,
  name,
  color = "#1d4ed8",
  className = "size-9 rounded-md",
}: {
  src: string | null;
  name: string;
  color?: string;
  className?: string;
}) {
  if (src)
    // eslint-disable-next-line @next/next/no-img-element -- small logos, some served from the database
    return <img src={src} alt="" className={`${className} shrink-0 object-contain`} />;
  return (
    <span
      aria-hidden
      className={`${className} inline-flex shrink-0 items-center justify-center font-bold text-white`}
      style={{ backgroundColor: color }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
