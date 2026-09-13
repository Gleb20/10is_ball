import { StrictMode } from "react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { MemoryRouter,useLocation } from "react-router-dom";
import { NotificationsPage } from "./NotificationsPage";
const mock=vi.hoisted(()=>({notifications:vi.fn(),respondMatchInvitation:vi.fn(),read:vi.fn()}));
let actorId="u";
vi.mock("../auth",()=>({useAuth:()=>({user:{id:actorId}})}));
vi.mock("../api",()=>({api:{notifications:mock.notifications,respondMatchInvitation:mock.respondMatchInvitation,markNotificationsReadVisible:mock.read}}));
beforeEach(()=>{actorId="u";mock.notifications.mockReset();mock.respondMatchInvitation.mockReset();mock.read.mockReset();mock.read.mockResolvedValue({notifications:[]});mock.respondMatchInvitation.mockResolvedValue({invitation:{status:"accepted",matchId:"m"}});});
afterEach(()=>cleanup());
function LocationProbe(){const location=useLocation();return <output data-testid="location">{location.pathname}</output>;}
it("GAP-008 offers actions on a read player invitation and retains terminal reason",async()=>{
 const invitation={id:"n",type:"match_invitation",title:"Внешний матч",body:"Участие",lifecycle:"read",readAt:"2026-09-13T10:00:00Z",actionable:true,payload:{invitationId:"i",matchId:"m"}};
 mock.notifications.mockResolvedValueOnce({notifications:[invitation]}).mockResolvedValue({notifications:[{...invitation,actionable:false,lifecycle:"accepted"}]});
 render(<MemoryRouter><NotificationsPage/></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:"Принять"}));
 expect(mock.respondMatchInvitation).toHaveBeenCalledWith("i",true);
});
it("GAP-008 history explains that a match started and does not offer invitation actions",async()=>{
 mock.notifications.mockResolvedValue({notifications:[{id:"n",type:"judge_invitation",title:"Завершённое приглашение",body:"Судья",lifecycle:"cancelled",actionable:false,reasonCode:"match_started",readAt:"2026-09-13T10:00:00Z",payload:{invitationId:"i",matchId:"m"}}]});
 render(<MemoryRouter><NotificationsPage/></MemoryRouter>);
 fireEvent.click(screen.getByRole("checkbox"));
 expect(await screen.findByText(/матч уже начался/i)).toBeVisible();
 expect(screen.queryByRole("button",{name:"Принять"})).not.toBeInTheDocument();
});
it("GAP-008 never shows the previous actor's rows while the next actor loads",async()=>{
 let resolveNext!:(value:{notifications:unknown[]})=>void;
 mock.notifications
  .mockResolvedValueOnce({notifications:[{id:"a",type:"account_role_changed",title:"Только для A",body:"Скрыто",lifecycle:"new",readAt:null}]})
  .mockImplementationOnce(()=>new Promise(resolve=>{resolveNext=resolve;}));
 const view=render(<MemoryRouter><NotificationsPage/></MemoryRouter>);
 expect(await screen.findByText("Только для A")).toBeVisible();
 actorId="b";view.rerender(<MemoryRouter><NotificationsPage/></MemoryRouter>);
 expect(screen.queryByText("Только для A")).not.toBeInTheDocument();
 resolveNext({notifications:[]});
 await waitFor(()=>expect(screen.getByText("Нет актуальных уведомлений")).toBeVisible());
});
it("GAP-008 ignores a previous actor's accepted response after an actor switch",async()=>{
 let resolveAccept!:(value:{invitation:{status:string;matchId:string}})=>void;
 mock.notifications.mockResolvedValueOnce({notifications:[{id:"n",type:"match_invitation",title:"Матч A",body:"Участие",lifecycle:"read",readAt:"2026-09-13T10:00:00Z",actionable:true,payload:{invitationId:"i",matchId:"m"}}]}).mockResolvedValue({notifications:[]});
 mock.respondMatchInvitation.mockImplementationOnce(()=>new Promise(resolve=>{resolveAccept=resolve;}));
 const view=render(<MemoryRouter initialEntries={["/notifications"]}><NotificationsPage/><LocationProbe/></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:"Принять"}));
 actorId="b";view.rerender(<MemoryRouter initialEntries={["/notifications"]}><NotificationsPage/><LocationProbe/></MemoryRouter>);
 resolveAccept({invitation:{status:"accepted",matchId:"m"}});
 await waitFor(()=>expect(screen.getByTestId("location")).toHaveTextContent("/notifications"));
});
it("GAP-008 opens a judge handover offer on the judge route",async()=>{
 mock.notifications.mockResolvedValue({notifications:[{id:"h",type:"judge_handover_offered",title:"Передача судейства",body:"Примите матч",lifecycle:"new",readAt:null,payload:{matchId:"m"}}]});
 render(<MemoryRouter initialEntries={["/notifications"]}><NotificationsPage/><LocationProbe/></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:"Открыть матч"}));
 expect(screen.getByTestId("location")).toHaveTextContent("/matches/m/judge");
});

it("GAP-008 loads notifications after StrictMode effect replay",async()=>{
 mock.notifications.mockResolvedValue({notifications:[{id:"strict",type:"account_access_changed",title:"Строгий режим",body:"Доступ обновлён",lifecycle:"new",readAt:null}]});
 render(<StrictMode><MemoryRouter><NotificationsPage/></MemoryRouter></StrictMode>);
 expect(await screen.findByText("Строгий режим")).toBeVisible();
});
