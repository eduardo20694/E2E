export default function Pedidos() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    fetch("/api/pedidos")
      .then((response) => response.json())
      .then(setItems);
  }, []);
  return (
    <div>
      <h1>Pedidos</h1>
      <a href="/novo">Novo</a>
      <button>Excluir conta</button>
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </div>
  );
}
