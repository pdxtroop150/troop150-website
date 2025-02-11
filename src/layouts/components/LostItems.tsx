import React, { useEffect, useState } from 'react';

interface Item {
  fname: string,
  description: string,
  id: string,
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
  }, []);

  return <ul className="list-none ps-0">
    {items.map(item => <li className="text-center my-20" key={item.id}>
      <h4> {item.fname}</h4> 
      <img src={`/lost-n-found/items/${item.id}`} />
      <p className="my-0">Description: {item.description}</p>
    </li>)}
  </ul>;
}

export default LostItems;
