import React from "react";

const Button = ({
  label,
  link,
  style,
  rel,
  open_in_new_tab,
}: {
  label: string;
  link: string;
  style?: string;
  rel?: string;
  open_in_new_tab?: boolean;
}) => {
  return (
    <a
      href={link}
      target={open_in_new_tab ? "_blank" : undefined}
      rel={`noopener noreferrer ${
        rel ? (rel === "follow" ? "" : rel) : "nofollow"
      }`}
      className={`btn mb-4 me-4 hover:text-white no-underline ${
        style === "outline" ? "btn-outline-primary" : "btn-primary"
      }`}
    >
      {label}
    </a>
  );
};

export default Button;
