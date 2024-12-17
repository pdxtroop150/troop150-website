import React, { useEffect, useState } from 'react';

interface Item {
  fname: string,
  description: string,
}

const LostItems = () => {
  const [items, setItems] = useState([] as Item[]);

  useEffect(() => {
    fetch("/lost-n-found/items")
      .then(response => {
        response.json()
          .then(data => setItems(data)
        )
      });
  });

  return <ul>
    {items.map(item => <li>
      <p>Name: {item.fname}</p>
      <p>Description: {item.description}</p>
    </li>)}
  </ul>;
}

export default LostItems;
